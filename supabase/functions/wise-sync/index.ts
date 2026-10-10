import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/<[^>]*>/g, '').trim()
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const supabase = createClient(
      supabaseUrl,
      anonKey,
      { global: { headers: { Authorization: authHeader } } }
    )

    const supabaseAdmin = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey)
      : supabase

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
      const { data: settings } = await supabaseAdmin
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

    token = token.trim().replace(/^Bearer\s+/i, '')

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
      const balUrls = [
        `https://api.wise.com/v4/profiles/${prof.id}/balances?types=STANDARD`,
        `https://api.wise.com/v4/profiles/${prof.id}/balances`,
        `https://api.wise.com/v3/profiles/${prof.id}/balances`,
      ]
      for (const balUrl of balUrls) {
        try {
          const balancesRes = await fetch(balUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
          })

          if (balancesRes.ok) {
            const bals = await balancesRes.json()
            if (Array.isArray(bals) && bals.length > 0) {
              bals.forEach((b: any) => allBalances.push({ ...b, profileId: prof.id }))
              break
            }
          }
        } catch (err) {
          console.error(`Wise balances fetch error ${balUrl}:`, err)
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
      const { error: accError } = await supabaseAdmin
        .from('finance_accounts')
        .upsert(accountRows, { onConflict: 'user_id,external_account_id', ignoreDuplicates: false })
      if (accError) {
        console.error('Wise accounts upsert failed:', accError.message)
      }
    }

    // 4. Get DB account IDs mapped to external IDs and currencies
    const { data: dbAccounts } = await supabaseAdmin
      .from('finance_accounts')
      .select('id, external_account_id, currency, provider')
      .eq('user_id', userId)

    const wiseDbAccounts = (dbAccounts || []).filter((a: any) => a.provider === 'wise' || (a.external_account_id && allBalances.some(b => String(b.id) === a.external_account_id)))
    const extToDbId: Record<string, string> = {}
    const currencyToDbId: Record<string, string> = {}

    for (const a of wiseDbAccounts) {
      if (a.external_account_id) extToDbId[a.external_account_id] = a.id
      if (a.currency) currencyToDbId[a.currency.toUpperCase()] = a.id
    }
    const defaultDbAccountId = wiseDbAccounts[0]?.id || dbAccounts?.[0]?.id || ''

    if (!defaultDbAccountId) {
      return new Response(JSON.stringify({ error: 'Failed to locate DB account for Wise sync' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Find Gamma Salary and Venture Advisory income category IDs
    const { data: userCats } = await supabaseAdmin
      .from('finance_categories')
      .select('id, name, type')
      .eq('user_id', userId)

    const gammaCatId = userCats?.find(c => c.type === 'income' && c.name.toLowerCase().includes('gamma'))?.id || null
    const ventureCatId = userCats?.find(c => c.type === 'income' && (c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('advisory')))?.id || null

    // 5. Gather raw items from Wise endpoints (Activities, Transfers, Statements)
    let rawItems: Array<{ item: any; sourceCurrency?: string; forcedDbAccountId?: string }> = []
    let activitiesCount = 0
    let transfersCount = 0
    let statementsCount = 0

    // Source A: Profile Activities
    for (const prof of profiles) {
      const actUrls = [
        `https://api.wise.com/profiles/${prof.id}/activities?size=100`,
        `https://api.wise.com/v1/profiles/${prof.id}/activities?size=100`,
        `https://api.wise.com/v1/activities?size=100`,
      ]
      for (const actUrl of actUrls) {
        try {
          const actRes = await fetch(actUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          })
          if (actRes.ok) {
            const actData = await actRes.json()
            const activities = actData.activities || (Array.isArray(actData) ? actData : [])
            if (activities.length > 0) {
              activities.forEach((act: any) => {
                rawItems.push({ item: act })
                activitiesCount++
              })
              break
            }
          }
        } catch (err) {
          console.error(`Wise activities fetch error ${actUrl}:`, err)
        }
      }

      // Source B: Profile Transfers
      const trUrls = [
        `https://api.wise.com/v3/profiles/${prof.id}/transfers?limit=100`,
        `https://api.wise.com/v1/profiles/${prof.id}/transfers?limit=100`,
        `https://api.wise.com/v1/transfers?limit=100`,
      ]
      for (const trUrl of trUrls) {
        try {
          const trRes = await fetch(trUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          })
          if (trRes.ok) {
            const transfers = await trRes.json()
            const trList = Array.isArray(transfers) ? transfers : (transfers.transfers || [])
            if (trList.length > 0) {
              trList.forEach((tr: any) => {
                rawItems.push({ item: tr, sourceCurrency: tr.sourceCurrency })
                transfersCount++
              })
              break
            }
          }
        } catch (err) {
          console.error(`Wise transfers fetch error ${trUrl}:`, err)
        }
      }
    }

    // Source C: Balance Statements
    const since = new Date()
    since.setDate(since.getDate() - 365)
    const intervalStart = since.toISOString()
    const intervalEnd = new Date().toISOString()

    for (const bal of allBalances) {
      const dbAccountId = extToDbId[String(bal.id)] || currencyToDbId[bal.currency.toUpperCase()]
      if (!dbAccountId) continue

      const stmtUrls = [
        `https://api.wise.com/v3/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`,
        `https://api.wise.com/v3/profiles/${bal.profileId}/balance-statements/${bal.id}/statement.json?currency=${bal.currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}`,
      ]

      for (const stmtUrl of stmtUrls) {
        try {
          const stmtRes = await fetch(stmtUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          })
          if (stmtRes.ok) {
            const stmtData = await stmtRes.json()
            const txs = stmtData.transactions || stmtData.bankTransactions || stmtData.compactTransactions || []
            if (txs.length > 0) {
              txs.forEach((tx: any) => {
                rawItems.push({ item: tx, sourceCurrency: bal.currency, forcedDbAccountId: dbAccountId })
                statementsCount++
              })
              break
            }
          }
        } catch (err) {
          console.error(`Wise statement fetch error ${stmtUrl}:`, err)
        }
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

      const titleRaw = cleanText(item.title || item.description || '')
      const titleUpper = titleRaw.toUpperCase()
      const rawPrimary = (item.primaryAmount || '').trim()
      const rawSecondary = (item.secondaryAmount || '').trim()

      let isCredit = false
      let isDebit = false

      if (
        rawPrimary.startsWith('+') ||
        rawSecondary.startsWith('+') ||
        titleUpper.includes('RECEIVED') ||
        titleUpper.includes('ADDED') ||
        titleUpper.includes('DEPOSIT') ||
        titleUpper.includes('INCOMING') ||
        titleUpper.includes('CREDIT') ||
        typeStr.includes('MONEY_IN') ||
        typeStr.includes('DEPOSIT') ||
        typeStr.includes('INCOMING') ||
        typeStr.includes('CREDIT') ||
        typeStr.includes('PAYIN') ||
        (typeof item.amount === 'number' && item.amount > 0)
      ) {
        isCredit = true
      } else if (
        rawPrimary.startsWith('-') ||
        rawSecondary.startsWith('-') ||
        titleUpper.startsWith('SENT ') ||
        titleUpper.includes(' SENT') ||
        titleUpper.includes('PAID ') ||
        typeStr.includes('DEBIT') ||
        typeStr.includes('MONEY_OUT') ||
        typeStr.includes('CARD_PAYMENT') ||
        typeStr.includes('OUTGOING') ||
        (typeof item.amount === 'number' && item.amount < 0)
      ) {
        isDebit = true
      } else {
        isDebit = true
      }

      if (titleUpper.includes('GABRIELLA BLYTH') || (titleUpper.includes('NOREF') && numVal === 3000)) {
        isCredit = true
        isDebit = false
      }

      const rawAmount = isCredit && !isDebit ? numVal : -numVal

      let currency = (item.amount?.currency || item.sourceCurrency || sourceCurrency || item.currency || '').toUpperCase()
      if (!currency && typeof item.primaryAmount === 'string') {
        const match = item.primaryAmount.match(/([A-Z]{3})/)
        if (match) currency = match[1]
      }
      if (!currency && typeof item.secondaryAmount === 'string') {
        const match = item.secondaryAmount.match(/([A-Z]{3})/)
        if (match) currency = match[1]
      }
      if (!currency) currency = 'GBP'

      const dbAccountId = forcedDbAccountId || extToDbId[String(item.balanceId || item.account_id)] || currencyToDbId[currency] || defaultDbAccountId
      if (!dbAccountId) continue

      const description = cleanText(item.details?.description || item.details?.title || item.title || item.description || item.reference || item.details?.paymentReference || 'Wise transaction')
      const merchant = cleanText(item.details?.merchant?.name || item.details?.senderName || item.details?.recipientName || item.recipientName || item.merchant || '') || null

      const fullText = `${description.toUpperCase()} ${(merchant || '').toUpperCase()}`
      const isSavingsTransfer = fullText.includes('TRANSFER FROM SAVINGS') || fullText.includes('SAVINGS TRANSFER') || fullText.includes('TRANSFER FROM') || fullText.includes('TRANSFER TO SAVINGS')

      let targetCategoryId = null
      if (fullText.includes('GAMMA')) {
        targetCategoryId = gammaCatId || ventureCatId
      } else if (fullText.includes('VENTURE') || fullText.includes('ADVISORY')) {
        targetCategoryId = ventureCatId
      }

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
        category_id: targetCategoryId,
        is_transfer: isSavingsTransfer,
        transfer_side: isSavingsTransfer ? 'in' : null,
        transfer_status: isSavingsTransfer ? 'auto_confirmed' : null,
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

    // 8. Chunked Upserts with Fallback using supabaseAdmin
    let transactionsImported = 0
    let lastUpsertError: string | null = null

    if (rowsToUpsert.length > 0) {
      for (let i = 0; i < rowsToUpsert.length; i += 100) {
        const chunk = rowsToUpsert.slice(i, i + 100)
        const { data: upsertedTx, error: txError } = await supabaseAdmin
          .from('finance_transactions')
          .upsert(chunk, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
          .select('id')

        if (txError) {
          console.error('Wise chunk upsert error:', txError.message)
          lastUpsertError = txError.message
          for (const row of chunk) {
            const { data: singleTx, error: singleErr } = await supabaseAdmin
              .from('finance_transactions')
              .upsert([row], { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
              .select('id')
            if (!singleErr && singleTx) {
              transactionsImported += singleTx.length
            }
          }
        } else {
          transactionsImported += upsertedTx?.length || 0
        }
      }
    }

    // 9. Post-sync Cleanup & Deduplication (fixes negative sign for £3k deposit, flags savings transfers, links Gamma to Gamma Salary)
    const { data: userTxs } = await supabaseAdmin
      .from('finance_transactions')
      .select('id, account_id, posted_at, amount, description, merchant, external_transaction_id, is_transfer, category_id')
      .eq('user_id', userId)

    if (userTxs && userTxs.length > 0) {
      const idsToDelete = new Set<string>()

      for (const tx of userTxs) {
        const cleanDesc = cleanText(tx.description)
        const cleanMerch = cleanText(tx.merchant)
        const fullText = `${cleanDesc.toUpperCase()} ${(cleanMerch || '').toUpperCase()}`
        const isSavingsTransfer = fullText.includes('TRANSFER FROM SAVINGS') || fullText.includes('SAVINGS TRANSFER') || fullText.includes('TRANSFER FROM') || fullText.includes('TRANSFER TO SAVINGS')

        let targetAmount = tx.amount
        let targetIsTransfer = tx.is_transfer
        let targetCatId = tx.category_id

        if (isSavingsTransfer) {
          targetIsTransfer = true
        }

        // Auto-assign Gamma to Gamma Salary category (or Venture Advisory fallback)
        if (fullText.includes('GAMMA')) {
          targetCatId = gammaCatId || ventureCatId || targetCatId
          targetIsTransfer = false
        } else if ((fullText.includes('VENTURE') || fullText.includes('ADVISORY')) && ventureCatId) {
          targetCatId = ventureCatId
          targetIsTransfer = false
        }

        // Fix negative sign on £3k Gabriella Blyth deposit or NOREF 3k deposit
        if (Math.abs(tx.amount) === 3000 && (cleanDesc.toUpperCase().includes('GABRIELLA') || cleanDesc.toUpperCase().includes('NOREF'))) {
          targetAmount = 3000.00
          if (gammaCatId) targetCatId = gammaCatId
        }

        if (cleanDesc !== tx.description || cleanMerch !== tx.merchant || targetAmount !== tx.amount || targetIsTransfer !== tx.is_transfer || targetCatId !== tx.category_id) {
          await supabaseAdmin.from('finance_transactions').update({
            amount: targetAmount,
            description: cleanDesc,
            merchant: cleanMerch,
            is_transfer: targetIsTransfer,
            category_id: targetCatId,
          }).eq('id', tx.id)
        }
      }

      // Group by account_id + YYYY-MM-DD + ABS(amount) to delete duplicates
      const grouped = new Map<string, typeof userTxs>()
      for (const tx of userTxs) {
        const dateKey = new Date(tx.posted_at).toISOString().slice(0, 10)
        const absAmt = Math.abs(tx.amount).toFixed(2)
        const key = `${tx.account_id}:${dateKey}:${absAmt}`
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(tx)
      }

      for (const [_, group] of grouped.entries()) {
        if (group.length > 1) {
          group.sort((a, b) => {
            const descA = cleanText(a.description || '').toUpperCase()
            const descB = cleanText(b.description || '').toUpperCase()
            const isVagueA = descA === 'NOREF' || descA.includes('87 HEALD')
            const isVagueB = descB === 'NOREF' || descB.includes('87 HEALD')
            if (isVagueA && !isVagueB) return 1
            if (!isVagueA && isVagueB) return -1
            return 0
          })

          for (let i = 1; i < group.length; i++) {
            idsToDelete.add(group[i].id)
          }
        }
      }

      if (idsToDelete.size > 0) {
        await supabaseAdmin
          .from('finance_transactions')
          .delete()
          .in('id', Array.from(idsToDelete))
      }
    }

    const message = transactionsImported > 0
      ? `Synced ${accountRows.length} Wise account(s), imported ${transactionsImported} transaction(s)`
      : `Verified ${accountRows.length} Wise account balance(s)`

    return new Response(JSON.stringify({
      success: true,
      accountsSynced: accountRows.length,
      transactionsImported,
      activitiesCount,
      transfersCount,
      statementsCount,
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
