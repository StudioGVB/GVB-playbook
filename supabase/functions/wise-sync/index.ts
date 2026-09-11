import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Validate JWT and get user
    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = userData.user.id
    const body = await req.json()
    let token = body.token || Deno.env.get('WISE_API_KEY')

    if (!token || typeof token !== 'string') {
      const { data: settings } = await supabase
        .from('finance_settings')
        .select('wise_api_token')
        .eq('user_id', userId)
        .maybeSingle()
      if (settings?.wise_api_token) {
        token = settings.wise_api_token
      }
    }

    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid Wise API token. Please configure your API key in Settings.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Fetch profiles
    const profilesRes = await fetch('https://api.wise.com/v1/profiles', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!profilesRes.ok) {
      return new Response(JSON.stringify({ error: `Wise profiles API error: ${profilesRes.status}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const profiles = await profilesRes.json()
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ error: 'No Wise profiles found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Fetch borderless accounts (balances) across all profiles
    let allBalances: any[] = []
    for (const prof of profiles) {
      const balancesRes = await fetch(`https://api.wise.com/v4/profiles/${prof.id}/balances`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      })

      if (balancesRes.ok) {
        const bals = await balancesRes.json()
        if (Array.isArray(bals)) {
          bals.forEach((b: any) => allBalances.push({ ...b, profileId: prof.id }))
        }
      }
    }

    if (allBalances.length === 0) {
      return new Response(JSON.stringify({ error: 'No Wise currency balances found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Upsert balances as accounts in database
    const accountRows = allBalances.map((bal: any) => ({
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
      if (accError) {
        console.error('Wise accounts upsert failed:', accError.message)
      }
    }

    // 4. Get DB account IDs mapped to external IDs (scoped to this user)
    const { data: dbAccounts } = await supabase
      .from('finance_accounts')
      .select('id, external_account_id')
      .eq('provider', 'wise')
      .eq('user_id', userId)

    const extToDbId: Record<string, string> = {}
    for (const a of (dbAccounts || [])) {
      if (a.external_account_id) extToDbId[a.external_account_id] = a.id
    }

    // 5. Fetch statements for each currency account (last 180 days)
    const since = new Date()
    since.setDate(since.getDate() - 180)
    const intervalStart = since.toISOString().slice(0, 19) + 'Z'
    const intervalEnd = new Date().toISOString().slice(0, 19) + 'Z'
    
    let allTransactions: Array<{ tx: any; dbAccountId: string; currency: string }> = []

    for (const bal of allBalances) {
      const dbAccountId = extToDbId[String(bal.id)]
      if (!dbAccountId) continue

      const stmtUrl = `https://api.wise.com/v3/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`
      
      let stmtRes = await fetch(stmtUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      })

      if (!stmtRes.ok) {
        const fallbackUrl = `https://api.wise.com/v3/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}`
        stmtRes = await fetch(fallbackUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        })
      }

      if (!stmtRes.ok) {
        const v1Url = `https://api.wise.com/v1/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`
        stmtRes = await fetch(v1Url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        })
      }

      if (stmtRes.ok) {
        const stmtData = await stmtRes.json()
        const txs = stmtData.transactions || stmtData.bankTransactions || []
        for (const tx of txs) {
          allTransactions.push({ tx, dbAccountId, currency: bal.currency })
        }
      } else {
        console.error(`Wise statement fetch failed for ${bal.currency} (profile ${bal.profileId}): ${stmtRes.status}`)
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
    const txBatch = await Promise.all(allTransactions.map(async ({ tx, dbAccountId, currency }) => {
      // Amount is negative for DEBIT
      const rawVal = parseFloat(tx.amount?.value || '0')
      const rawAmount = tx.type === 'DEBIT' ? -rawVal : rawVal
      
      const postedAt = tx.date || tx.postedAt || new Date().toISOString()
      const description = tx.details?.description || tx.details?.title || tx.details?.paymentReference || tx.description || tx.reference || 'Wise transaction'
      const merchant = tx.details?.merchant?.name || tx.details?.senderName || tx.details?.recipientName || tx.merchant || null
      
      const fingerprint = await computeFingerprint(userId, dbAccountId, postedAt, rawAmount, description)
      const externalTxId = tx.id ? String(tx.id) : fingerprint

      // Auto-flag GAMMA salary as income/transfers
      const isSalary = description.toUpperCase().includes('GAMMA') && rawAmount > 0

      return {
        user_id: userId,
        account_id: dbAccountId,
        external_transaction_id: externalTxId,
        posted_at: postedAt,
        description,
        merchant,
        amount: rawAmount,
        currency: tx.amount?.currency || currency || 'AUD',
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

      if (existingExternalIds.has(externalKey)) {
        rowsToUpsert.push(row)
      } else if (existingFingerprints.has(row.transaction_fingerprint)) {
        // Skip duplicate fingerprint
      } else if (dedupedNewTransactions.has(row.transaction_fingerprint)) {
        // Skip duplicate in current batch
      } else {
        dedupedNewTransactions.set(row.transaction_fingerprint, row)
        rowsToUpsert.push(row)
      }
    }

    let transactionsImported = 0
    if (rowsToUpsert.length > 0) {
      const { data: upsertedTx, error: txError } = await supabase
        .from('finance_transactions')
        .upsert(rowsToUpsert, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
        .select('id')

      if (txError) {
        console.error('Wise transactions upsert failed:', txError.message)
      } else {
        transactionsImported = upsertedTx?.length || 0
      }
    }

    return new Response(JSON.stringify({
      success: true,
      accountsSynced: accountRows.length,
      transactionsImported,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in wise-sync:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
