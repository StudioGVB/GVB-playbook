import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/<[^>]*>/g, '').trim()
}

serve(async (req) => {
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const token = Deno.env.get('WISE_API_KEY')
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'WISE_API_KEY not configured' }), { status: 400 })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    )

    // Find all users who have Wise accounts
    const { data: wiseAccounts, error: accFetchErr } = await supabaseAdmin
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

        // 2. Fetch borderless accounts (balances)
        let balances: any[] = []
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
              bals.forEach((b: any) => balances.push({ ...b, profileId: prof.id }))
            }
          }
        }

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
          exclude_from_totals: false,
        }))

        if (accountRows.length > 0) {
          const { error: accError } = await supabaseAdmin
            .from('finance_accounts')
            .upsert(accountRows, { onConflict: 'user_id,external_account_id', ignoreDuplicates: false })
          if (accError) console.error(`Account upsert failed for ${userId}:`, accError.message)
        }

        // 4. Get DB IDs for accounts & categories
        const { data: dbAccounts } = await supabaseAdmin
          .from('finance_accounts')
          .select('id, external_account_id, currency, provider')
          .eq('user_id', userId)

        const wiseDbAccounts = (dbAccounts || []).filter((a: any) => a.provider === 'wise' || (a.external_account_id && balances.some(b => String(b.id) === a.external_account_id)))
        const extToDbId: Record<string, string> = {}
        const currencyToDbId: Record<string, string> = {}

        for (const a of wiseDbAccounts) {
          if (a.external_account_id) extToDbId[a.external_account_id] = a.id
          if (a.currency) currencyToDbId[a.currency.toUpperCase()] = a.id
        }
        const defaultDbAccountId = wiseDbAccounts[0]?.id || dbAccounts?.[0]?.id || ''

        if (!defaultDbAccountId) continue

        const { data: userCats } = await supabaseAdmin
          .from('finance_categories')
          .select('id, name, type')
          .eq('user_id', userId)

        const gammaCatId = userCats?.find(c => c.type === 'income' && c.name.toLowerCase().includes('gamma'))?.id || null
        const ventureCatId = userCats?.find(c => c.type === 'income' && (c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('advisory')))?.id || null

        // 5. Gather raw items from all Wise endpoints
        let rawItems: Array<{ item: any; sourceCurrency?: string; forcedDbAccountId?: string }> = []

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
                  activities.forEach((act: any) => rawItems.push({ item: act }))
                  break
                }
              }
            } catch (err) {
              console.error(`Wise cron activities fetch error profile ${prof.id}:`, err)
            }
          }

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
                  trList.forEach((tr: any) => rawItems.push({ item: tr, sourceCurrency: tr.sourceCurrency }))
                  break
                }
              }
            } catch (err) {
              console.error(`Wise cron transfers fetch error profile ${prof.id}:`, err)
            }
          }
        }

        const since = new Date()
        since.setDate(since.getDate() - 365)
        const intervalStart = since.toISOString()
        const intervalEnd = new Date().toISOString()

        for (const bal of balances) {
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
                  txs.forEach((tx: any) => rawItems.push({ item: tx, sourceCurrency: bal.currency, forcedDbAccountId: dbAccountId }))
                  break
                }
              }
            } catch (err) {
              console.error(`Wise cron statement fetch error balance ${bal.id}:`, err)
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

        // 6. Transform transactions
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
        let importedCount = 0
        if (rowsToUpsert.length > 0) {
          for (let i = 0; i < rowsToUpsert.length; i += 100) {
            const chunk = rowsToUpsert.slice(i, i + 100)
            const { data: upsertedTx, error: txError } = await supabaseAdmin
              .from('finance_transactions')
              .upsert(chunk, { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
              .select('id')

            if (txError) {
              console.error(`Tx chunk upsert failed for user ${userId}:`, txError.message)
              for (const row of chunk) {
                const { data: singleTx, error: singleErr } = await supabaseAdmin
                  .from('finance_transactions')
                  .upsert([row], { onConflict: 'account_id,external_transaction_id', ignoreDuplicates: false })
                  .select('id')
                if (!singleErr && singleTx) {
                  importedCount += singleTx.length
                }
              }
            } else {
              importedCount += upsertedTx?.length || 0
            }
          }
        }

        // 9. Post-sync Cleanup & Deduplication
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

            if (fullText.includes('GAMMA')) {
              targetCatId = gammaCatId || ventureCatId || targetCatId
              targetIsTransfer = false
            } else if ((fullText.includes('VENTURE') || fullText.includes('ADVISORY')) && ventureCatId) {
              targetCatId = ventureCatId
              targetIsTransfer = false
            }

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

        // 10. Auto-categorise
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
