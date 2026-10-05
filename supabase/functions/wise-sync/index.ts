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
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

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
      exclude_from_totals: false,
    }))

    if (accountRows.length > 0) {
      const { error: accError } = await supabase
        .from('finance_accounts')
        .upsert(accountRows, { onConflict: 'user_id,external_account_id', ignoreDuplicates: false })
      if (accError) {
        console.error('Wise accounts upsert failed:', accError.message)
      }
    }

    // 4. Get DB account IDs mapped to external IDs and currencies (scoped to this user)
    const { data: dbAccounts } = await supabase
      .from('finance_accounts')
      .select('id, external_account_id, currency, provider')
      .eq('user_id', userId)

    const wiseDbAccounts = (dbAccounts || []).filter((a: any) => a.provider === 'wise' || (a.external_account_id && allBalances.some(b => String(b.id) === a.external_account_id)))
    const extToDbId: Record<string, string> = {}
    const currencyToDbId: Record<string, string> = {}

    for (const a of wiseDbAccounts) {
      if (a.external_account_id) extToDbId[a.external_account_id] = a.id
      if (a.currency) currencyToDbId[a.currency] = a.id
    }
    const defaultDbAccountId = wiseDbAccounts[0]?.id || dbAccounts?.[0]?.id || ''

    if (!defaultDbAccountId) {
      return new Response(JSON.stringify({ error: 'Failed to locate DB account for Wise sync' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Gather raw items from Wise endpoints (Activities, Transfers, Statements)
    let rawItems: Array<{ item: any; sourceCurrency?: string; forcedDbAccountId?: string }> = []

    for (const prof of profiles) {
      try {
        const actRes = await fetch(`https://api.wise.com/v1/profiles/${prof.id}/activities?limit=100`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        })
        if (actRes.ok) {
          const actData = await actRes.json()
          const activities = actData.activities || (Array.isArray(actData) ? actData : [])
          activities.forEach((act: any) => rawItems.push({ item: act }))
        }
      } catch (err) {
        console.error(`Wise activities fetch error profile ${prof.id}:`, err)
      }

      try {
        const trRes = await fetch(`https://api.wise.com/v1/profiles/${prof.id}/transfers?limit=100`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        })
        if (trRes.ok) {
          const transfers = await trRes.json()
          if (Array.isArray(transfers)) {
            transfers.forEach((tr: any) => rawItems.push({ item: tr, sourceCurrency: tr.sourceCurrency }))
          }
        }
      } catch (err) {
        console.error(`Wise transfers fetch error profile ${prof.id}:`, err)
      }
    }

    const since = new Date()
    since.setDate(since.getDate() - 180)
    const intervalStart = since.toISOString().slice(0, 19) + 'Z'
    const intervalEnd = new Date().toISOString().slice(0, 19) + 'Z'

    for (const bal of allBalances) {
      const dbAccountId = extToDbId[String(bal.id)]
      if (!dbAccountId) continue

      try {
        const stmtUrl = `https://api.wise.com/v3/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`
        let stmtRes = await fetch(stmtUrl, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        })
        if (!stmtRes.ok) {
          const fallbackUrl = `https://api.wise.com/v3/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?intervalStart=${intervalStart}&intervalEnd=${intervalEnd}`
          stmtRes = await fetch(fallbackUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          })
        }
        if (stmtRes.ok) {
          const stmtData = await stmtRes.json()
          const txs = stmtData.transactions || stmtData.bankTransactions || stmtData.compactTransactions || []
          txs.forEach((tx: any) => rawItems.push({ item: tx, sourceCurrency: bal.currency, forcedDbAccountId: dbAccountId }))
        }
      } catch (err) {
        console.error(`Wise statement fetch error balance ${bal.id}:`, err)
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

    // 6. Transform and parse items
    const txBatch: any[] = []

    for (const { item, sourceCurrency, forcedDbAccountId } of rawItems) {
      const statusStr = (item.status || '').toLowerCase()
      if (statusStr === 'cancelled' || statusStr === 'rejected' || statusStr === 'failed') {
        continue
      }

      const postedAt = item.date || item.postedAt || item.createdOn || item.created || new Date().toISOString()
      const typeStr = (item.type || item.details?.type || item.resource?.type || '').toUpperCase()

      let numVal = 0
      if (typeof item.amount === 'number') {
        numVal = Math.abs(item.amount)
      } else if (item.amount?.value !== undefined) {
        numVal = Math.abs(parseFloat(item.amount.value) || 0)
      } else if (typeof item.sourceValue === 'number') {
        numVal = Math.abs(item.sourceValue)
      } else if (typeof item.targetValue === 'number' && !numVal) {
        numVal = Math.abs(item.targetValue)
      } else if (typeof item.amount === 'string') {
        numVal = Math.abs(parseFloat(item.amount) || 0)
      } else if (typeof item.primaryAmount === 'string') {
        const cleanStr = item.primaryAmount.replace(/,/g, '')
        const match = cleanStr.match(/([0-9.]+)/)
        if (match) numVal = Math.abs(parseFloat(match[1]) || 0)
      }

      if (numVal === 0 && typeof item.secondaryAmount === 'string') {
        const cleanStr = item.secondaryAmount.replace(/,/g, '')
        const match = cleanStr.match(/([0-9.]+)/)
        if (match) numVal = Math.abs(parseFloat(match[1]) || 0)
      }

      if (numVal === 0) continue

      const titleStr = (item.title || item.description || '').toUpperCase()
      const rawPrimary = (item.primaryAmount || '').trim()

      let isDebit = false
      let isCredit = false

      if (rawPrimary.startsWith('-') || titleStr.includes('SENT ') || titleStr.includes('PAID ')) {
        isDebit = true
      } else if (rawPrimary.startsWith('+') || titleStr.includes('RECEIVED ') || titleStr.includes('ADDED ')) {
        isCredit = true
      } else if (typeStr.includes('DEBIT') || typeStr.includes('MONEY_OUT') || typeStr.includes('CARD_PAYMENT') || typeStr.includes('SENT') || typeStr.includes('OUTGOING') || typeStr.includes('PAYMENT') || statusStr.includes('outgoing')) {
        isDebit = true
      } else if (typeStr.includes('CREDIT') || typeStr.includes('MONEY_IN') || typeStr.includes('DEPOSIT') || typeStr.includes('RECEIVED') || typeStr.includes('INCOMING') || typeStr.includes('PAYIN')) {
        isCredit = true
      } else if (typeof item.amount === 'number' && item.amount < 0) {
        isDebit = true
      } else if (typeof item.amount === 'number' && item.amount > 0) {
        isCredit = true
      } else {
        isDebit = true
      }

      const rawAmount = isDebit ? -numVal : numVal
      const currency = item.amount?.currency || item.sourceCurrency || sourceCurrency || item.currency || 'GBP'

      const dbAccountId = forcedDbAccountId || currencyToDbId[currency] || defaultDbAccountId
      if (!dbAccountId) continue

      const description = item.details?.description || item.details?.title || item.title || item.description || item.reference || item.details?.paymentReference || 'Wise transaction'
      const merchant = item.details?.merchant?.name || item.details?.senderName || item.details?.recipientName || item.recipientName || item.merchant || null

      const fingerprint = await computeFingerprint(userId, dbAccountId, postedAt, rawAmount, description)
      const externalTxId = item.id ? String(item.id) : fingerprint

      txBatch.push({
        user_id: userId,
        account_id: dbAccountId,
        external_transaction_id: externalTxId,
        posted_at: postedAt,
        description,
        merchant,
        amount: rawAmount,
        currency,
        is_transfer: false,
        transfer_side: null,
        transfer_status: null,
        transaction_fingerprint: fingerprint,
        raw: {
          reference: item.reference || null,
          detailsType: item.details?.type || item.type || null,
        },
      })
    }

    // 7. Deduplicate in-memory by account_id + external_transaction_id
    const batchMap = new Map<string, typeof txBatch[number]>()
    for (const row of txBatch) {
      const key = `${row.account_id}:${row.external_transaction_id}`
      if (!batchMap.has(key)) {
        batchMap.set(key, row)
      }
    }
    const rowsToUpsert = Array.from(batchMap.values())

    // 8. Chunked Upserts with Fallback
    let transactionsImported = 0
    if (rowsToUpsert.length > 0) {
      for (let i = 0; i < rowsToUpsert.length; i += 100) {
        const chunk = rowsToUpsert.slice(i, i + 100)
        const { data: upsertedTx, error: txError } = await supabase
          .from('finance_transactions')
          .upsert(chunk, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
          .select('id')

        if (txError) {
          console.error('Wise chunk upsert error:', txError.message)
          for (const row of chunk) {
            const { data: singleTx, error: singleErr } = await supabase
              .from('finance_transactions')
              .upsert([row], { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
              .select('id')
            if (!singleErr && singleTx) {
              transactionsImported += singleTx.length
            } else if (singleErr) {
              console.error(`Single tx upsert failed: ${singleErr.message}`, row)
            }
          }
        } else {
          transactionsImported += upsertedTx?.length || 0
        }
      }
    }

    const message = transactionsImported > 0
      ? `Synced ${accountRows.length} Wise account(s), imported ${transactionsImported} transaction(s)`
      : `Verified ${accountRows.length} Wise account balance(s) (${rawItems.length} transaction(s) scanned, ${rowsToUpsert.length} prepared)`

    return new Response(JSON.stringify({
      success: true,
      accountsSynced: accountRows.length,
      transactionsImported,
      message,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in wise-sync:', error)
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
