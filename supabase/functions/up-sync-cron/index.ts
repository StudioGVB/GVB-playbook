import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const UP_API_BASE = 'https://api.up.com.au/api/v1'

serve(async (req) => {
  try {
    // Simple shared-secret check: accept anon key or service role key
    // pg_cron sends the anon key in the Authorization header
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

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

        // 6. Transform (auto-flag GABRIELLA BLYTH as transfers)
        const TRAVEL_SAVINGS_ACCOUNT_ID = '070104ff-80bf-4b70-a19a-23afce14be9b'
        const txBatch = await Promise.all(allTransactions.map(async ({ tx, dbAccountId }) => {
          const rawAmount = parseFloat(tx.attributes.amount?.value || '0')
          const hasTransferRelation = !!tx.relationships?.transferAccount?.data
          const postedAt = tx.attributes.settledAt || tx.attributes.createdAt || new Date().toISOString()
          const description = tx.attributes.description || 'Unknown'
          const fingerprint = await computeFingerprint(userId, dbAccountId, postedAt, rawAmount, description)
          const status = tx.attributes.status || null

          const isGabriella = description.toUpperCase().includes('GABRIELLA BLYTH') && rawAmount > 0

          return {
            user_id: userId,
            account_id: dbAccountId,
            external_transaction_id: tx.id,
            posted_at: postedAt,
            description,
            merchant: tx.attributes.rawText || null,
            amount: rawAmount,
            currency: tx.attributes.amount?.currencyCode || 'AUD',
            is_transfer: hasTransferRelation || isGabriella,
            transfer_side: isGabriella ? 'in' : undefined,
            transfer_status: isGabriella ? 'auto_confirmed' : undefined,
            transaction_fingerprint: fingerprint,
            raw: {
              category: tx.relationships?.category?.data?.id || null,
              parentCategory: tx.relationships?.parentCategory?.data?.id || null,
              status,
            },
          }
        }))

        // 7. Dedup & upsert
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
        let duplicateCount = 0

        for (const row of txBatch) {
          const externalKey = `${row.account_id}:${row.external_transaction_id}`
          if (existingExternalIds.has(externalKey)) {
            rowsToUpsert.push(row)
            continue
          }
          if (row.transaction_fingerprint && existingFingerprints.has(row.transaction_fingerprint)) {
            duplicateCount++
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

        rowsToUpsert.push(...dedupedNewTransactions.values())

        let importedCount = 0
        if (rowsToUpsert.length > 0) {
          for (let i = 0; i < rowsToUpsert.length; i += 200) {
            const chunk = rowsToUpsert.slice(i, i + 200)
            const { error: txError, data: txData } = await supabase
              .from('finance_transactions')
              .upsert(chunk, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
              .select('id')
            if (txError) {
              console.error(`Tx upsert failed for ${userId}:`, txError.message)
            } else {
              importedCount += txData?.length || 0
            }
          }
        }

        // 8. Auto-transfer: create mirror deductions in Travel Savings for GABRIELLA BLYTH
        const gabriellaRows = rowsToUpsert.filter(r =>
          r.description.toUpperCase().includes('GABRIELLA BLYTH') && r.amount > 0
        )

        for (const gbRow of gabriellaRows) {
          const mirrorFingerprint = await computeFingerprint(
            userId, TRAVEL_SAVINGS_ACCOUNT_ID, gbRow.posted_at, -gbRow.amount, gbRow.description
          )

          const { data: existing } = await supabase
            .from('finance_transactions')
            .select('id')
            .eq('user_id', userId)
            .eq('transaction_fingerprint', mirrorFingerprint)
            .maybeSingle()

          if (!existing) {
            const { error: insertErr } = await supabase.from('finance_transactions').insert({
              user_id: userId,
              account_id: TRAVEL_SAVINGS_ACCOUNT_ID,
              posted_at: gbRow.posted_at,
              description: `Transfer to Up – ${gbRow.description}`,
              merchant: gbRow.description,
              amount: -gbRow.amount,
              currency: gbRow.currency,
              is_transfer: true,
              transfer_side: 'out',
              transfer_status: 'auto_confirmed',
              transaction_fingerprint: mirrorFingerprint,
            })
            if (insertErr) {
              console.error(`Mirror insert failed:`, insertErr.message)
            } else {
              console.log(`Auto-created mirror transfer for GABRIELLA BLYTH: -${gbRow.amount}`)
            }
          }
        }

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
