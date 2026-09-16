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
    let rawToken = body.token
    let refreshToken = ''
    let tokenExpiresAt = 0

    if (!rawToken) {
      try {
        const { data: settingsData } = await supabase
          .from('finance_settings')
          .select('bank_tokens')
          .eq('user_id', userId)
          .maybeSingle()

        if (settingsData?.bank_tokens?.monzo) {
          rawToken = settingsData.bank_tokens.monzo
          refreshToken = settingsData.bank_tokens.monzo_refresh || ''
          tokenExpiresAt = settingsData.bank_tokens.monzo_expires_at || 0
        }
      } catch (err) {
        console.error('Failed to read Monzo token from database settings:', err)
      }
    }

    // Auto-refresh token if expired or about to expire
    if (refreshToken && (Date.now() >= tokenExpiresAt - 300000 || !rawToken)) {
      try {
        const MONZO_CLIENT_ID = Deno.env.get('MONZO_CLIENT_ID') || 'oauth2client_0000BAIUMhrA8jDgU6Ydmr'
        const MONZO_CLIENT_SECRET = Deno.env.get('MONZO_CLIENT_SECRET') || 'mnzconf.JA9atqjwUDCgObnSS2gVRHUFrPSNRk6CdFAybM01d0fnxleruKXLQsD7jpMb22CzbrfYBpT+StD+7CjWJqugMA=='

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
          rawToken = freshData.access_token
          const newRefresh = freshData.refresh_token || refreshToken
          const newExpires = Date.now() + ((freshData.expires_in || 21600) * 1000)

          // Save fresh tokens
          const { data: settingsData } = await supabase
            .from('finance_settings')
            .select('bank_tokens')
            .eq('user_id', userId)
            .maybeSingle()

          const bankTokens = settingsData?.bank_tokens || {}
          bankTokens.monzo = rawToken
          bankTokens.monzo_refresh = newRefresh
          bankTokens.monzo_expires_at = newExpires

          await supabase.from('finance_settings').upsert({
            user_id: userId,
            bank_tokens: bankTokens,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
        }
      } catch (refErr) {
        console.error('Failed to refresh Monzo token:', refErr)
      }
    }

    if (!rawToken) {
      rawToken = Deno.env.get('MONZO_ACCESS_TOKEN')
    }

    if (!rawToken || typeof rawToken !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid token. Please authorize Monzo OAuth connection.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = rawToken.replace(/\s+/g, '')

    // 1. Fetch accounts
    const accountsRes = await fetch('https://api.monzo.com/accounts', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!accountsRes.ok) {
      return new Response(JSON.stringify({ error: `Monzo accounts API error: ${accountsRes.status}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsRes.json()
    const accounts = accountsData.accounts || []

    if (accounts.length === 0) {
      return new Response(JSON.stringify({ error: 'No Monzo accounts found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      if (accError) {
        console.error('Monzo accounts upsert failed:', accError.message)
      }
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
    // Monzo requires since as ISO string without milliseconds usually, or just ISO
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

      if (!txRes.ok) {
        console.error(`Monzo transaction fetch failed for account ${acc.id}: ${txRes.status}`)
        continue
      }

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
      // Amount in pence, convert to main unit
      const rawAmount = (tx.amount || 0) / 100
      const postedAt = tx.settled || tx.created || new Date().toISOString()
      const description = tx.description || 'Monzo transaction'
      const merchant = tx.merchant?.name || tx.description || null
      
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
        console.error('Monzo transactions upsert failed:', txError.message)
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
    console.error('Error in monzo-sync:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
