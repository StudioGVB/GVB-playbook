import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

serve(async (req) => {
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const token = Deno.env.get('WISE_API_KEY')
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'WISE_API_KEY not configured' }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    )

    // Find all users who have Wise accounts
    const { data: wiseAccounts, error: accFetchErr } = await supabase
      .from('finance_accounts')
      .select('user_id')
      .eq('provider', 'wise')

    if (accFetchErr || !wiseAccounts) {
      console.error('Failed to fetch Wise users:', accFetchErr?.message)
      return new Response(JSON.stringify({ error: 'Failed to fetch users' }), { status: 500 })
    }

    // Dedupe user IDs
    const userIds = [...new Set(wiseAccounts.map(a => a.user_id))]
    console.log(`Wise cron sync: found ${userIds.length} user(s) with Wise accounts`)

    const results: Array<{ userId: string; accounts: number; transactions: number; error?: string }> = []

    for (const userId of userIds) {
      try {
        // 1. Fetch profiles
        const profilesRes = await fetch('https://api.wise.com/v1/profiles', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        })

        if (!profilesRes.ok) {
          results.push({ userId, accounts: 0, transactions: 0, error: `Wise profiles API ${profilesRes.status}` })
          continue
        }

        const profiles = await profilesRes.json()
        if (!profiles || profiles.length === 0) {
          results.push({ userId, accounts: 0, transactions: 0, error: 'No Wise profiles found' })
          continue
        }

        const profileId = profiles[0].id

        // 2. Fetch borderless accounts (balances)
        const balancesRes = await fetch(`https://api.wise.com/v4/profiles/${profileId}/balances?types=STANDARD`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        })

        if (!balancesRes.ok) {
          results.push({ userId, accounts: 0, transactions: 0, error: `Wise balances API ${balancesRes.status}` })
          continue
        }

        const balances = await balancesRes.json()

        // 3. Upsert balances
        const accountRows = balances.map((bal: any) => ({
          user_id: userId,
          provider: 'wise',
          account_name: `Wise ${bal.currency}`,
          currency: bal.currency,
          balance: parseFloat(bal.amount?.value || '0'),
          external_account_id: String(bal.id),
          last_synced_at: new Date().toISOString(),
          source_type: 'bank',
        }))

        if (accountRows.length > 0) {
          const { error: accError } = await supabase
            .from('finance_accounts')
            .upsert(accountRows, { onConflict: 'user_id,external_account_id', ignoreDuplicates: false })
          if (accError) console.error(`Account upsert failed for ${userId}:`, accError.message)
        }

        // 4. Get DB IDs for accounts
        const { data: dbAccounts } = await supabase
          .from('finance_accounts')
          .select('id, external_account_id')
          .eq('provider', 'wise')
          .eq('user_id', userId)

        const extToDbId: Record<string, string> = {}
        for (const a of (dbAccounts || [])) {
          if (a.external_account_id) extToDbId[a.external_account_id] = a.id
        }

        // 5. Fetch statements for each currency account (last 90 days)
        const since = new Date()
        since.setDate(since.getDate() - 90)
        const intervalStart = since.toISOString()
        const intervalEnd = new Date().toISOString()
        
        let allTransactions: Array<{ tx: any; dbAccountId: string }> = []

        for (const bal of balances) {
          const dbAccountId = extToDbId[String(bal.id)]
          if (!dbAccountId) continue

          const stmtUrl = `https://api.wise.com/v3/profiles/${profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`
          
          let stmtRes = await fetch(stmtUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
          })

          if (!stmtRes.ok) {
            const fallbackUrl = `https://api.wise.com/v3/profiles/${profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}`
            stmtRes = await fetch(fallbackUrl, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
              },
            })
          }

          if (!stmtRes.ok) continue

          const stmtData = await stmtRes.json()
          const txs = stmtData.transactions || []
          
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

        // 6. Transform transactions
        const txBatch = await Promise.all(allTransactions.map(async ({ tx, dbAccountId }) => {
          const rawVal = parseFloat(tx.amount?.value || '0')
          const rawAmount = tx.type === 'DEBIT' ? -rawVal : rawVal
          const postedAt = tx.date || new Date().toISOString()
          const description = tx.details?.description || tx.description || tx.details?.title || tx.reference || 'Wise transaction'
          const merchant = tx.details?.merchant?.name || tx.details?.senderName || tx.details?.recipientName || tx.merchant || null
          
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
            currency: tx.amount?.currency || 'GBP',
            is_transfer: isSalary,
            transfer_side: isSalary ? 'in' : undefined,
            transfer_status: isSalary ? 'auto_confirmed' : undefined,
            transaction_fingerprint: fingerprint,
            raw: {
              reference: tx.reference || null,
              detailsType: tx.details?.type || null,
            },
          }
        }))

        // 7. Dedup against existing records
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

        // 8. Auto-categorise
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
    console.error('wise-sync-cron error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }
})
