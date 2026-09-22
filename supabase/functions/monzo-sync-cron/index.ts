import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

serve(async (req) => {
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const fallbackToken = Deno.env.get('MONZO_ACCESS_TOKEN')
    const MONZO_CLIENT_ID = Deno.env.get('MONZO_CLIENT_ID') || 'oauth2client_0000BAIUMhrA8jDgU6Ydmr'
    const MONZO_CLIENT_SECRET = Deno.env.get('MONZO_CLIENT_SECRET') || 'mnzconf.JA9atqjwUDCgObnSS2gVRHUFrPSNRk6CdFAybM01d0fnxleruKXLQs07jpMb22CzbrfYBpT+5tD+7CjWJqugMA=='

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

        // 5. Transform transactions
        const txBatch = await Promise.all(allTransactions.map(async ({ tx, dbAccountId }) => {
          const rawAmount = (tx.amount || 0) / 100
          const postedAt = tx.settled || tx.created || new Date().toISOString()
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
              .select('account_id, external_transaction_id, transaction_fingerprint')
              .eq('user_id', userId)
              .in('account_id', dbAccountIds)
          : { data: [] }

        const existingExternalIds = new Set(
          (existingTransactions || [])
            .filter((row: any) => row.external_transaction_id)
            .map((row: any) => `${row.account_id}:${row.external_transaction_id}`)
        )
        const existingFingerprints = new Set(
          (existingTransactions || [])
            .map((row: any) => row.transaction_fingerprint)
            .filter(Boolean)
        )

        const dedupedNewTransactions = new Map<string, typeof txBatch[number]>()
        const rowsToUpsert: typeof txBatch = []

        for (const row of txBatch) {
          const externalKey = `${row.account_id}:${row.external_transaction_id}`
          if (existingExternalIds.has(externalKey)) {
            rowsToUpsert.push(row)
            continue
          }
          if (row.transaction_fingerprint && existingFingerprints.has(row.transaction_fingerprint)) {
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
