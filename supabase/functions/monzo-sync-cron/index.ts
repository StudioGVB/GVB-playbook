import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

serve(async (req) => {
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const token = Deno.env.get('MONZO_ACCESS_TOKEN')
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'MONZO_ACCESS_TOKEN not configured' }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    )

    // Find all users who have Monzo accounts
    const { data: monzoAccounts, error: accFetchErr } = await supabase
      .from('finance_accounts')
      .select('user_id')
      .eq('provider', 'monzo')

    if (accFetchErr || !monzoAccounts) {
      console.error('Failed to fetch Monzo users:', accFetchErr?.message)
      return new Response(JSON.stringify({ error: 'Failed to fetch users' }), { status: 500 })
    }

    // Dedupe user IDs
    const userIds = [...new Set(monzoAccounts.map(a => a.user_id))]
    console.log(`Monzo cron sync: found ${userIds.length} user(s) with Monzo accounts`)

    const results: Array<{ userId: string; accounts: number; transactions: number; error?: string }> = []

    for (const userId of userIds) {
      try {
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
