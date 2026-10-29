import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const cronSecret = Deno.env.get('CRON_SECRET')

    const isAuthorized =
      (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) ||
      (anonKey && authHeader === `Bearer ${anonKey}`) ||
      (cronSecret && authHeader === `Bearer ${cronSecret}`)

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const fallbackToken = Deno.env.get('MONZO_ACCESS_TOKEN')
    const MONZO_CLIENT_ID = Deno.env.get('MONZO_CLIENT_ID') || ''
    const MONZO_CLIENT_SECRET = Deno.env.get('MONZO_CLIENT_SECRET') || ''

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    )

    // Find all users who have Monzo accounts or settings
    const { data: monzoAccounts } = await supabase
      .from('finance_accounts')
      .select('user_id')
      .eq('provider', 'monzo')

    const { data: monzoSettings } = await supabase
      .from('finance_settings')
      .select('user_id')

    const allUserIds = [
      ...(monzoAccounts || []).map(a => a.user_id),
      ...(monzoSettings || []).map(s => s.user_id)
    ]
    const userIds = [...new Set(allUserIds)]

    console.log(`Monzo cron sync: found ${userIds.length} candidate user(s)`)

    const results: Array<{ userId: string; accounts: number; transactions: number; error?: string }> = []

    for (const userId of userIds) {
      try {
        let token = fallbackToken || ''
        let refreshToken = ''
        let tokenExpiresAt = 0

        // Fetch user tokens from settings
        const { data: settingsData } = await supabase
          .from('finance_settings')
          .select('bank_tokens')
          .eq('user_id', userId)
          .maybeSingle()

        if (settingsData?.bank_tokens?.monzo) {
          token = settingsData.bank_tokens.monzo
          refreshToken = settingsData.bank_tokens.monzo_refresh || ''
          tokenExpiresAt = settingsData.bank_tokens.monzo_expires_at || 0
        }

        // Auto-refresh token if refresh token is available and token is expired/expiring
        if (refreshToken && (Date.now() >= tokenExpiresAt - 300000 || !token)) {
          try {
            const refreshRes = await fetch('https://api.monzo.com/oauth2/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: MONZO_CLIENT_ID,
                client_secret: MONZO_CLIENT_SECRET,
                refresh_token: refreshToken,
              }).toString(),
            })

            if (refreshRes.ok) {
              const freshData = await refreshRes.json()
              token = freshData.access_token
              const newRefresh = freshData.refresh_token || refreshToken
              const newExpires = Date.now() + ((freshData.expires_in || 21600) * 1000)

              const bankTokens = settingsData?.bank_tokens || {}
              bankTokens.monzo = token
              bankTokens.monzo_refresh = newRefresh
              bankTokens.monzo_expires_at = newExpires

              await supabase.from('finance_settings').upsert({
                user_id: userId,
                bank_tokens: bankTokens,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' })
            } else {
              console.error(`Monzo refresh failed for user ${userId}: ${refreshRes.status}`)
            }
          } catch (refErr) {
            console.error(`Error refreshing Monzo token for ${userId}:`, refErr)
          }
        }

        if (!token) {
          continue
        }

        // 1. Fetch accounts
        const accountsRes = await fetch('https://api.monzo.com/accounts', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        })

        if (!accountsRes.ok) {
          results.push({ userId, accounts: 0, transactions: 0, error: `Monzo accounts API ${accountsRes.status}` })
          continue
        }

        const accountsData = await accountsRes.json()
        const accounts = accountsData.accounts || []

        if (accounts.length === 0) {
          results.push({ userId, accounts: 0, transactions: 0, error: 'No Monzo accounts found' })
          continue
        }

        // 2. Fetch balances & upsert accounts
        const accountRows = []
        for (const acc of accounts) {
          const balanceRes = await fetch(`https://api.monzo.com/balance?account_id=${acc.id}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
          })

          let balanceVal = 0
          if (balanceRes.ok) {
            const balData = await balanceRes.json()
            balanceVal = (balData.balance || 0) / 100
          }

          accountRows.push({
            user_id: userId,
            provider: 'monzo',
            account_name: acc.description || `Monzo ${acc.type || 'Account'}`,
            currency: acc.currency || 'GBP',
            balance: balanceVal,
            external_account_id: String(acc.id),
            last_synced_at: new Date().toISOString(),
            source_type: 'bank',
          })
        }

        if (accountRows.length > 0) {
          const { error: accError } = await supabase
            .from('finance_accounts')
            .upsert(accountRows, { onConflict: 'user_id,external_account_id', ignoreDuplicates: false })
          if (accError) console.error(`Account upsert failed for ${userId}:`, accError.message)
        }

        // 3. Get DB account IDs mapped to external IDs (scoped to this user)
        const { data: dbAccounts } = await supabase
          .from('finance_accounts')
          .select('id, external_account_id')
          .eq('provider', 'monzo')
          .eq('user_id', userId)

        const extToDbId: Record<string, string> = {}
        for (const a of (dbAccounts || [])) {
          if (a.external_account_id) extToDbId[a.external_account_id] = a.id
        }

        // 4. Fetch transactions for each account (last 90 days)
        const since = new Date()
        since.setDate(since.getDate() - 90)
        const sinceStr = since.toISOString().split('.')[0] + 'Z'
        
        let allTransactions: Array<{ tx: any; dbAccountId: string }> = []

        for (const acc of accounts) {
          const dbAccountId = extToDbId[String(acc.id)]
          if (!dbAccountId) continue

          const txUrl = `https://api.monzo.com/transactions?account_id=${acc.id}&since=${sinceStr}&limit=100&expand[]=merchant`
          
          const txRes = await fetch(txUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
          })

          if (!txRes.ok) continue

          const txData = await txRes.json()
          const txs = txData.transactions || []
          
          for (const tx of txs) {
            allTransactions.push({ tx, dbAccountId })
          }
        }

        // Fingerprint helper
        async function computeFingerprint(uid: string, accId: string, postedAt: string, amount: number, desc: string): Promise<string> {
          const dateOnly = new Date(postedAt).toISOString().slice(0, 10)
          const normDesc = desc.toUpperCase().trim().replace(/\s+/g, ' ').replace(/[^A-Z0-9 ]/g, '')
          const input = `${uid}|${accId}|${dateOnly}|${amount.toFixed(2)}|${normDesc}`
          const buf = new TextEncoder().encode(input)
          const hash = await crypto.subtle.digest('SHA-256', buf)
          return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
        }

        function cleanMerch(s: string): string {
          return (s || '')
            .toUpperCase()
            .replace(/[^A-Z0-9 ]/g, ' ')
            .replace(/\b(LTD|PLC|INC|CORP|CO|UK|GB|MANCHESTER|LONDON|MANCHES|MCHESTE|STORE|STORES|CARD|PURCHASE|PAYMENT|COM|COUK)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        }

        function areMerchantsMatchEdge(descA = '', merchA = '', descB = '', merchB = ''): boolean {
          const textA = `${descA} ${merchA}`.toLowerCase()
          const textB = `${descB} ${merchB}`.toLowerCase()

          if (/\b(amazon|amzn)\b/.test(textA) && /\b(amazon|amzn)\b/.test(textB)) return true
          if (/\btesco\b/.test(textA) && /\btesco\b/.test(textB)) return true
          if (/\bhabibi\b/.test(textA) && /\bhabibi\b/.test(textB)) return true
          if (/\blidl\b/.test(textA) && /\blidl\b/.test(textB)) return true
          if (/\bgreggs\b/.test(textA) && /\bgreggs\b/.test(textB)) return true
          if (/\bprimark\b/.test(textA) && /\bprimark\b/.test(textB)) return true
          if (/\b(tfgm|beenetwork|greater manchester|piccadilly)\b/.test(textA) && /\b(tfgm|beenetwork|greater manchester|piccadilly)\b/.test(textB)) return true
          if (/\b(tfl|transport for london)\b/.test(textA) && /\b(tfl|transport for london)\b/.test(textB)) return true
          if (/\bthree square\b/.test(textA) && /\bthree square\b/.test(textB)) return true
          if (/\bcosta\b/.test(textA) && /\bcosta\b/.test(textB)) return true
          if (/\b(m14 crispy|crispy burger)\b/.test(textA) && /\b(m14 crispy|crispy burger)\b/.test(textB)) return true
          if (/\bko twins\b/.test(textA) && /\bko twins\b/.test(textB)) return true
          if (/\bsainsbury/.test(textA) && /\bsainsbury/.test(textB)) return true
          if (/\baldi\b/.test(textA) && /\baldi\b/.test(textB)) return true
          if (/\basda\b/.test(textA) && /\basda\b/.test(textB)) return true
          if (/\b(m&s|marks and spencer|marks & spencer)\b/.test(textA) && /\b(m&s|marks and spencer|marks & spencer)\b/.test(textB)) return true
          if (/\bboots\b/.test(textA) && /\bboots\b/.test(textB)) return true

          const cleanA = cleanMerch(textA)
          const cleanB = cleanMerch(textB)
          if (!cleanA || !cleanB) return false
          if (cleanA === cleanB) return true

          const compA = cleanA.replace(/\s+/g, '')
          const compB = cleanB.replace(/\s+/g, '')
          if (compA.length >= 4 && compB.length >= 4) {
            if (compA.includes(compB) || compB.includes(compA)) return true
            if (compA.slice(0, 6) === compB.slice(0, 6) && compA.length >= 6) return true
          }

          const wordsA = cleanA.split(' ').filter(w => w.length >= 4)
          const wordsB = cleanB.split(' ').filter(w => w.length >= 4)
          for (const w of wordsA) {
            if (wordsB.includes(w)) return true
          }
          return false
        }

        // 5. Transform transactions
        const txBatch = await Promise.all(allTransactions.map(async ({ tx, dbAccountId }) => {
          // Amount in pence, convert to main unit
          const rawAmount = (tx.amount || 0) / 100
          
          // Prioritize tx.created (when the purchase actually took place, e.g. Saturday night)
          // over tx.settled (when Mastercard cleared the funds 1-3 business days later, e.g. Monday morning)
          const postedAt = tx.created || tx.settled || new Date().toISOString()
          const description = tx.description || 'Monzo transaction'
          const merchant = tx.merchant?.name || tx.description || null
          
          const fingerprint = await computeFingerprint(userId, dbAccountId, postedAt, rawAmount, description)
          const externalTxId = tx.id ? String(tx.id) : fingerprint

          const isSalary = description.toUpperCase().includes('GAMMA') && rawAmount > 0

          return {
            user_id: userId,
            account_id: dbAccountId,
            external_transaction_id: externalTxId,
            posted_at: postedAt,
            description,
            merchant,
            amount: rawAmount,
            currency: tx.currency || 'GBP',
            is_transfer: isSalary,
            transfer_side: isSalary ? 'in' : undefined,
            transfer_status: isSalary ? 'auto_confirmed' : undefined,
            transaction_fingerprint: fingerprint,
            raw: {
              category: tx.category || null,
              merchantId: tx.merchant?.id || null,
              scheme: tx.scheme || null,
            },
          }
        }))

        // 6. Dedup against existing records
        const dbAccountIds = Object.values(extToDbId)
        const { data: existingTransactions } = dbAccountIds.length > 0
          ? await supabase
              .from('finance_transactions')
              .select('id, account_id, external_transaction_id, transaction_fingerprint, category_id, is_transfer, goal_id, is_fixed, amount, description, merchant, posted_at')
              .eq('user_id', userId)
              .in('account_id', dbAccountIds)
          : { data: [] }

        const existingMap = new Map<string, any>()
        const existingExternalIds = new Set<string>()
        for (const row of existingTransactions || []) {
          if (row.external_transaction_id) {
            const k = `${row.account_id}:${row.external_transaction_id}`
            existingExternalIds.add(k)
            existingMap.set(k, row)
          }
        }
        const existingFingerprints = new Set(
          (existingTransactions || [])
            .map((row: any) => row.transaction_fingerprint)
            .filter(Boolean)
        )

        const matchedExistingIds = new Set<string>()
        const dedupedNewTransactions = new Map<string, typeof txBatch[number]>()
        const rowsToUpsert: typeof txBatch = []

        for (const row of txBatch) {
          const externalKey = `${row.account_id}:${row.external_transaction_id}`
          if (existingExternalIds.has(externalKey)) {
            const existing = existingMap.get(externalKey)
            if (existing) {
              (row as any).category_id = existing.category_id !== undefined ? existing.category_id : null
              if (existing.is_transfer !== undefined && existing.is_transfer !== null) {
                row.is_transfer = existing.is_transfer
              }
              if (existing.goal_id !== undefined) (row as any).goal_id = existing.goal_id
              if (existing.is_fixed !== undefined) (row as any).is_fixed = existing.is_fixed
            }
            rowsToUpsert.push(row)
            continue
          }
          if (row.transaction_fingerprint && existingFingerprints.has(row.transaction_fingerprint)) {
            continue
          }

          // Check for clearing / CSV duplicate match against existing records
          const match = (existingTransactions || []).find((existing: any) => {
            if (matchedExistingIds.has(existing.id)) return false
            if (existing.account_id !== row.account_id) return false
            const amtExist = Math.abs(Number(existing.amount) || 0)
            const amtRow = Math.abs(Number(row.amount) || 0)
            if (Math.abs(amtExist - amtRow) > 0.005) return false
            if ((Number(existing.amount) < 0) !== (Number(row.amount) < 0)) return false

            const dExist = new Date(existing.posted_at).getTime()
            const dRow = new Date(row.posted_at).getTime()
            const diffDays = Math.abs(dExist - dRow) / (1000 * 60 * 60 * 24)
            if (diffDays > 4.5) return false

            return areMerchantsMatchEdge(existing.description, existing.merchant, row.description, row.merchant)
          })

          if (match) {
            matchedExistingIds.add(match.id)
            await supabase.from('finance_transactions').update({
              external_transaction_id: row.external_transaction_id,
              transaction_fingerprint: row.transaction_fingerprint,
              raw: row.raw,
            }).eq('id', match.id)
            continue
          }

          const dedupeKey = row.transaction_fingerprint || externalKey
          if (!dedupedNewTransactions.has(dedupeKey)) {
            dedupedNewTransactions.set(dedupeKey, row)
          }
        }

        rowsToUpsert.push(...dedupedNewTransactions.values())

        let importedCount = 0
        if (rowsToUpsert.length > 0) {
          const { data: upsertedTx, error: txError } = await supabase
            .from('finance_transactions')
            .upsert(rowsToUpsert, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
            .select('id')

          if (txError) {
            console.error(`Tx upsert failed for user ${userId}:`, txError.message)
          } else {
            importedCount = upsertedTx?.length || 0
          }
        }

        // 7. Auto-categorise
        try {
          await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/finance-categorize`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ user_id: userId }),
            }
          )
        } catch (catErr) {
          console.error(`Auto-categorise failed for ${userId}:`, catErr)
        }

        results.push({ userId, accounts: accountRows.length, transactions: importedCount })
      } catch (userErr) {
        console.error(`Error syncing user ${userId}:`, userErr)
        results.push({ userId, accounts: 0, transactions: 0, error: String(userErr) })
      }
    }

    return new Response(JSON.stringify({
      success: true,
      usersSynced: userIds.length,
      results,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('monzo-sync-cron error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }
})
