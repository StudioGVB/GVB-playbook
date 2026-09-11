import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const UP_API_BASE = 'https://api.up.com.au/api/v1'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = userData.user.id

    const upToken = Deno.env.get('UP_ACCESS_TOKEN')
    if (!upToken) {
      return new Response(JSON.stringify({ error: 'UP_ACCESS_TOKEN not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const upHeaders = {
      'Authorization': `Bearer ${upToken}`,
      'Accept': 'application/json',
    }

    // 1. Fetch all Up accounts
    const accountsRes = await fetch(`${UP_API_BASE}/accounts`, { headers: upHeaders })
    if (!accountsRes.ok) {
      return new Response(JSON.stringify({ error: `Up API error: ${accountsRes.status}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsRes.json()
    const upAccounts = accountsData.data || []

    // 2. Upsert accounts
    const accountRows = upAccounts.map((acc: any) => ({
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
      if (accError) {
        console.error('Account upsert failed:', accError.message)
      }
    }

    // 3. Get DB account IDs mapped to external IDs (scoped to this user)
    const { data: dbAccounts } = await supabase
      .from('finance_accounts')
      .select('id, external_account_id')
      .eq('provider', 'up')
      .eq('user_id', userId)

    const extToDbId: Record<string, string> = {}
    for (const a of (dbAccounts || [])) {
      if (a.external_account_id) extToDbId[a.external_account_id] = a.id
    }

    // 4. Fetch transactions per-account (last 90 days), with pagination
    const since = new Date()
    since.setDate(since.getDate() - 90)
    let allTransactions: Array<{ tx: any; dbAccountId: string }> = []

    for (const upAccount of upAccounts) {
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
        // Safety cap: 2000 total across all accounts
        if (allTransactions.length >= 2000) break
      }
      if (allTransactions.length >= 2000) break
    }

    // Fingerprint helper (matches client-side logic)
    async function computeFingerprint(uid: string, accId: string, postedAt: string, amount: number, desc: string): Promise<string> {
      const dateOnly = new Date(postedAt).toISOString().slice(0, 10)
      const normDesc = desc.toUpperCase().trim().replace(/\s+/g, ' ').replace(/[^A-Z0-9 ]/g, '')
      const input = `${uid}|${accId}|${dateOnly}|${amount.toFixed(2)}|${normDesc}`
      const buf = new TextEncoder().encode(input)
      const hash = await crypto.subtle.digest('SHA-256', buf)
      return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
    }

    const isSettled = (status?: string | null) => (status || '').toUpperCase() === 'SETTLED'

    // 5. Transform transactions (auto-flag GABRIELLA BLYTH as transfers)
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

    // 6. Preload existing transactions so duplicate fingerprints don't break entire chunks
    let importedCount = 0
    let duplicateCount = 0
    const dbAccountIds = Object.values(extToDbId)

    const { data: existingTransactions, error: existingTxError } = dbAccountIds.length > 0
      ? await supabase
          .from('finance_transactions')
          .select('account_id, external_transaction_id, transaction_fingerprint')
          .eq('user_id', userId)
          .in('account_id', dbAccountIds)
      : { data: [], error: null }

    if (existingTxError) {
      console.error('Existing transaction preload failed:', existingTxError.message)
    }

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

      // Existing external IDs should still upsert so balances/details stay current
      if (existingExternalIds.has(externalKey)) {
        rowsToUpsert.push(row)
        continue
      }

      // Skip rows that would collide with an existing fingerprint
      if (row.transaction_fingerprint && existingFingerprints.has(row.transaction_fingerprint)) {
        duplicateCount += 1
        continue
      }

      const dedupeKey = row.transaction_fingerprint || externalKey
      const current = dedupedNewTransactions.get(dedupeKey)

      if (!current) {
        dedupedNewTransactions.set(dedupeKey, row)
        continue
      }

      // Prefer settled records over pending duplicates within the same sync payload
      const currentSettled = isSettled((current.raw as any)?.status)
      const nextSettled = isSettled((row.raw as any)?.status)
      if (!currentSettled && nextSettled) {
        dedupedNewTransactions.set(dedupeKey, row)
      }
      duplicateCount += 1
    }

    rowsToUpsert.push(...dedupedNewTransactions.values())

    if (rowsToUpsert.length > 0) {
      for (let i = 0; i < rowsToUpsert.length; i += 200) {
        const chunk = rowsToUpsert.slice(i, i + 200)
        const { error: txError, data: txData } = await supabase
          .from('finance_transactions')
          .upsert(chunk, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
          .select('id')
        if (txError) {
          console.error('Transaction upsert failed:', txError.message)
        } else {
          importedCount += txData?.length || 0
        }
      }
    }

    // 7. Auto-transfer rule: GABRIELLA BLYTH → mark as transfer + mirror to Travel Savings
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
        await supabase.from('finance_transactions').insert({
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
        console.log(`Auto-created mirror transfer for GABRIELLA BLYTH: -${gbRow.amount}`)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      accountsSynced: accountRows.length,
      transactionsImported: importedCount,
      totalFetched: allTransactions.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('up-sync error')
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
