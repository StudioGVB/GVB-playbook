import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const UP_API_BASE = 'https://api.up.com.au/api/v1'

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

    const upToken = Deno.env.get('UP_ACCESS_TOKEN')
    if (!upToken) {
      return new Response(JSON.stringify({ error: 'UP_ACCESS_TOKEN not configured' }), { status: 400 })
    }

    // Use service role to bypass RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    )

    // Find all users who have Up accounts
    const { data: upAccounts, error: accFetchErr } = await supabase
      .from('finance_accounts')
      .select('user_id')
      .eq('provider', 'up')

    if (accFetchErr || !upAccounts) {
      console.error('Failed to fetch Up users:', accFetchErr?.message)
      return new Response(JSON.stringify({ error: 'Failed to fetch users' }), { status: 500 })
    }

    // Dedupe user IDs
    const userIds = [...new Set(upAccounts.map(a => a.user_id))]
    console.log(`Nightly sync: found ${userIds.length} user(s) with Up accounts`)

    const upHeaders = {
      'Authorization': `Bearer ${upToken}`,
      'Accept': 'application/json',
    }

    const results: Array<{ userId: string; accounts: number; transactions: number; error?: string }> = []

    for (const userId of userIds) {
      try {
        // 1. Fetch all Up accounts from API
        const accountsRes = await fetch(`${UP_API_BASE}/accounts`, { headers: upHeaders })
        if (!accountsRes.ok) {
          results.push({ userId, accounts: 0, transactions: 0, error: `Up API ${accountsRes.status}` })
          continue
        }

        const accountsData = await accountsRes.json()
        const upApiAccounts = accountsData.data || []

        // 2. Upsert accounts
        const accountRows = upApiAccounts.map((acc: any) => ({
          user_id: userId,
          provider: 'up',
          account_name: acc.attributes.displayName || 'Up Account',
          currency: acc.attributes.balance?.currencyCode || 'AUD',
          balance: parseFloat(acc.attributes.balance?.value || '0'),
          external_account_id: acc.id,
          last_synced_at: new Date().toISOString(),
          source_type: 'bank',
        }))

        if (accountRows.length > 0) {
          const { error: accError } = await supabase
            .from('finance_accounts')
            .upsert(accountRows, { onConflict: 'user_id,external_account_id', ignoreDuplicates: false })
          if (accError) console.error(`Account upsert failed for ${userId}:`, accError.message)
        }

        // 3. Map external IDs to DB IDs
        const { data: dbAccounts } = await supabase
          .from('finance_accounts')
          .select('id, external_account_id')
          .eq('provider', 'up')
          .eq('user_id', userId)

        const extToDbId: Record<string, string> = {}
        for (const a of (dbAccounts || [])) {
          if (a.external_account_id) extToDbId[a.external_account_id] = a.id
        }

        // 4. Fetch transactions (last 90 days)
        const since = new Date()
        since.setDate(since.getDate() - 90)
        let allTransactions: Array<{ tx: any; dbAccountId: string }> = []

        for (const upAccount of upApiAccounts) {
          const dbAccountId = extToDbId[upAccount.id]
          if (!dbAccountId) continue

          let txUrl: string | null = `${UP_API_BASE}/accounts/${upAccount.id}/transactions?filter[since]=${since.toISOString()}&page[size]=100`

          while (txUrl) {
            const txRes = await fetch(txUrl, { headers: upHeaders })
            if (!txRes.ok) break
            const txData = await txRes.json()
            for (const tx of (txData.data || [])) {
              allTransactions.push({ tx, dbAccountId })
            }
            txUrl = txData.links?.next || null
            if (allTransactions.length >= 2000) break
          }
          if (allTransactions.length >= 2000) break
        }

        // 5. Fingerprint helper
        async function computeFingerprint(uid: string, accId: string, postedAt: string, amount: number, desc: string): Promise<string> {
          const dateOnly = new Date(postedAt).toISOString().slice(0, 10)
          const normDesc = desc.toUpperCase().trim().replace(/\s+/g, ' ').replace(/[^A-Z0-9 ]/g, '')
          const input = `${uid}|${accId}|${dateOnly}|${amount.toFixed(2)}|${normDesc}`
          const buf = new TextEncoder().encode(input)
          const hash = await crypto.subtle.digest('SHA-256', buf)
          return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
        }

        const isSettled = (status?: string | null) => (status || '').toUpperCase() === 'SETTLED'

        // Fetch user categories for auto-assigning Venture Advisory income
        const { data: userCats } = await supabase
          .from('finance_categories')
          .select('id, name, type')
          .eq('user_id', userId)

        const ventureCatId = userCats?.find((c: any) =>
          c.type === 'income' && (c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('batchbase'))
        )?.id || null

        // 6. Transform (auto-flag GABRIELLA BLYTH as transfers, except batchbase income)
        const TRAVEL_SAVINGS_ACCOUNT_ID = '070104ff-80bf-4b70-a19a-23afce14be9b'
        const txBatch = await Promise.all(allTransactions.map(async ({ tx, dbAccountId }) => {
          const rawAmount = parseFloat(tx.attributes.amount?.value || '0')
          const hasTransferRelation = !!tx.relationships?.transferAccount?.data
          const postedAt = tx.attributes.settledAt || tx.attributes.createdAt || new Date().toISOString()
          const description = tx.attributes.description || 'Unknown'
          const rawText = tx.attributes.rawText || ''
          const message = tx.attributes.message || ''
          const tagIds = ((tx.relationships?.tags?.data || []) as any[]).map((t: any) => String(t?.id || '').toLowerCase())

          const fullText = `${description} ${rawText} ${message} ${tagIds.join(' ')}`.toLowerCase()
          const isBatchbase = fullText.includes('batchbase') || fullText.includes('batch base') || tagIds.includes('batchbase') || tagIds.includes('batch')
          const isGabriella = description.toUpperCase().includes('GABRIELLA BLYTH') || description.toUpperCase().includes('GABRIELLA')
          const isWeeklyPaycheck = rawAmount > 0 && (
            (rawAmount >= 60 && rawAmount <= 90) ||
            (rawAmount >= 120 && rawAmount <= 180) ||
            Math.abs(rawAmount - 72.8) < 0.5 ||
            Math.abs(rawAmount - 140) < 1.0
          )
          const isVentureIncome = (isBatchbase || (isGabriella && isWeeklyPaycheck)) && rawAmount > 0

          const fingerprint = await computeFingerprint(userId, dbAccountId, postedAt, rawAmount, description)
          const status = tx.attributes.status || null

          return {
            user_id: userId,
            account_id: dbAccountId,
            external_transaction_id: tx.id,
            posted_at: postedAt,
            description,
            merchant: rawText || null,
            amount: rawAmount,
            currency: tx.attributes.amount?.currencyCode || 'AUD',
            category_id: isVentureIncome ? ventureCatId : null,
            is_transfer: !isVentureIncome && hasTransferRelation,
            transfer_side: null as string | null,
            transfer_status: null as string | null,
            goal_id: null as string | null,
            is_fixed: false,
            transaction_fingerprint: fingerprint,
            raw: {
              category: tx.relationships?.category?.data?.id || null,
              parentCategory: tx.relationships?.parentCategory?.data?.id || null,
              status,
              message: message || null,
              tags: tagIds.length > 0 ? tagIds : null,
            },
          }
        }))

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

        // 7. Dedup & upsert
        const dbAccountIds = Object.values(extToDbId)
        const { data: existingTransactions } = dbAccountIds.length > 0
          ? await supabase
              .from('finance_transactions')
              .select('id, account_id, external_transaction_id, transaction_fingerprint, category_id, is_transfer, goal_id, is_fixed, amount, description, merchant, posted_at')
              .eq('user_id', userId)
              .in('account_id', dbAccountIds)
              .order('posted_at', { ascending: false })
              .limit(5000)
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
        let duplicateCount = 0

        for (const row of txBatch) {
          const externalKey = `${row.account_id}:${row.external_transaction_id}`
          if (existingExternalIds.has(externalKey)) {
            const existing = existingMap.get(externalKey)
            if (existing) {
              row.category_id = existing.category_id ?? null
              if (existing.is_transfer !== undefined && existing.is_transfer !== null) {
                row.is_transfer = existing.is_transfer
              }
              row.goal_id = existing.goal_id ?? null
              row.is_fixed = existing.is_fixed ?? false
            }
            rowsToUpsert.push(row)
            continue
          }
          if (row.transaction_fingerprint && existingFingerprints.has(row.transaction_fingerprint)) {
            duplicateCount++
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
            duplicateCount++
            await supabase.from('finance_transactions').update({
              external_transaction_id: row.external_transaction_id,
              transaction_fingerprint: row.transaction_fingerprint,
              raw: row.raw,
            }).eq('id', match.id)
            continue
          }

          const dedupeKey = row.transaction_fingerprint || externalKey
          const current = dedupedNewTransactions.get(dedupeKey)
          if (!current) {
            dedupedNewTransactions.set(dedupeKey, row)
            continue
          }
          const currentSettled = isSettled((current.raw as any)?.status)
          const nextSettled = isSettled((row.raw as any)?.status)
          if (!currentSettled && nextSettled) {
            dedupedNewTransactions.set(dedupeKey, row)
          }
          duplicateCount++
        }

        // Put NEW transactions first so they are always imported first!
        rowsToUpsert.unshift(...dedupedNewTransactions.values())

        let importedCount = 0
        if (rowsToUpsert.length > 0) {
          for (let i = 0; i < rowsToUpsert.length; i += 100) {
            const chunk = rowsToUpsert.slice(i, i + 100)
            const { error: txError, data: txData } = await supabase
              .from('finance_transactions')
              .upsert(chunk, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
              .select('id')
            if (txError) {
              console.error(`Tx chunk upsert failed for ${userId}, falling back to single-row:`, txError.message)
              for (const row of chunk) {
                const { data: singleTx, error: singleErr } = await supabase
                  .from('finance_transactions')
                  .upsert([row], { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
                  .select('id')
                if (!singleErr && singleTx) {
                  importedCount += singleTx.length
                }
              }
            } else {
              importedCount += txData?.length || 0
            }
          }
        }

        // 8. Purge any fake mirror deductions previously created in Travel Savings for Gabriella Blyth / batchbase
        await supabase
          .from('finance_transactions')
          .delete()
          .eq('user_id', userId)
          .eq('account_id', TRAVEL_SAVINGS_ACCOUNT_ID)
          .or('description.ilike.%batchbase%,description.ilike.%batch base%,description.ilike.%Transfer to Up – GABRIELLA BLYTH%,description.ilike.%Transfer to Up - GABRIELLA BLYTH%,description.ilike.%GABRIELLA BLYTH%')

        // Auto-categorise after sync
        try {
          const catRes = await fetch(
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
          if (catRes.ok) {
            const catData = await catRes.json()
            console.log(`Auto-categorised for ${userId}: ${catData.categorized} (${catData.rule} rules, ${catData.ai} AI)`)
          }
        } catch (catErr) {
          console.error(`Auto-categorise failed for ${userId}:`, catErr)
        }

        results.push({ userId, accounts: accountRows.length, transactions: importedCount })
        console.log(`Synced user ${userId}: ${accountRows.length} accounts, ${importedCount} transactions`)

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
    console.error('up-sync-cron error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }
})
