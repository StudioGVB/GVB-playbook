import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Rule-based keyword mapping (case-insensitive)
const CATEGORY_RULES: Record<string, string[]> = {
  'Groceries': ['WOOLWORTHS', 'COLES', 'ALDI', 'IGA', 'HARRIS FARM', 'TESCO', 'SAINSBURY', 'LIDL', 'COSTCO', 'FRESH MARKET', 'BUTCHER', 'FRUIT', 'BAKERY', 'GROCER'],
  'Transport': ['UBER ', 'UBER TRIP', 'PTV', 'OPAL', 'MYKI', 'BOLT', 'TFL', 'TFGM', 'DIDI', 'LYFT', 'TAXI', 'PARKING', 'FUEL', 'PETROL', 'SHELL ', 'BP ', 'CALTEX', '7-ELEVEN', 'BEENETWORK', 'BEE NETWORK', 'TRAINLINE', 'NATIONAL RAIL', 'AVANTI', 'NORTHERN RAIL', 'MEGABUS', 'NATIONAL EXPRESS', 'FLIXBUS', 'GO-AHEAD', 'STAGECOACH', 'ARRIVA', 'FIRST BUS'],
  'Subscriptions': [],
  'Eating Out': ['MCDONALD', 'KFC', 'UBER EATS', 'DOORDASH', 'MENULOG', 'DELIVEROO', 'CAFE', 'COFFEE', 'RESTAURANT', 'BAR ', 'PUB ', 'PIZZA', 'NANDO', 'GYG', 'SUBWAY', 'HUNGRY JACK', 'STARBUCKS', 'GREGGS', 'WETHERSPOON', 'BREWDOG', 'PRET A MANGER', 'PRET ', 'ITSU', 'WAGAMAMA', 'FIVE GUYS', 'BURGER', 'SUSHI', 'THAI', 'INDIAN', 'CHINESE', 'KEBAB', 'CHIPPY', 'FISH AND CHIP', 'GRILL', 'DINER', 'EATERY', 'BRASSERIE', 'BISTRO', 'JUST EAT', 'TAKEAWAY'],
  'Bills': ['NETFLIX', 'SPOTIFY', 'APPLE.COM', 'GOOGLE STORAGE', 'YOUTUBE', 'DISNEY', 'STAN', 'BINGE', 'KAYO', 'AMAZON PRIME', 'CANVA', 'ADOBE', 'NOTION', 'GITHUB', 'FIGMA', 'CRUNCHYROLL', 'PARAMOUNT', 'CHATGPT', 'OPENAI', 'CLAUDE', 'ANTHROPIC', 'ENERGY', 'WATER', 'TELSTRA', 'OPTUS', 'VODAFONE', 'INTERNET', 'INSURANCE', 'ELECTRICITY', 'GAS BILL', 'COUNCIL', 'THREE ', 'EE ', 'O2 ', 'BRITISH GAS', 'OCTOPUS', 'THAMES WATER', 'NHS'],

  'Rent': ['RENT', 'LEASE', 'LANDLORD', 'REAL ESTATE', 'PROPERTY', 'LETTING'],
  'Shopping': ['KMART', 'TARGET', 'BIG W', 'BUNNINGS', 'IKEA', 'JB HI-FI', 'OFFICEWORKS', 'AMAZON', 'EBAY', 'UNIQLO', 'ZARA', 'H&M', 'COTTON ON', 'PRIMARK', 'TK MAXX', 'TKMAXX', 'SPORTS DIRECT', 'DECATHLON', 'BOOTS', 'SUPERDRUG', 'PHARMACY', 'CHEMIST', 'JOHN LEWIS', 'MARKS SPENCER', 'M&S', 'ARGOS', 'CURRYS', 'WILKO', 'POUNDLAND', 'HOME BARGAIN', 'B&M', 'ASDA', 'ALDI', 'TESCO'],
  'Transfers': [],
}

// Up Bank category → user category mapping
const UP_CATEGORY_MAP: Record<string, string> = {
  'groceries': 'Groceries',
  'fuel': 'Transport',
  'public-transport': 'Transport',
  'taxis-and-share-cars': 'Transport',
  'tv-and-music': 'Bills',
  'mobile-phone': 'Bills',
  'internet': 'Bills',
  'takeaway': 'Eating Out',
  'restaurants-and-cafes': 'Eating Out',
  'pubs-and-bars': 'Eating Out',
  'booze': 'Eating Out',
  'events-and-gigs': 'Eating Out',
  'clothing-and-accessories': 'Shopping',
  'homeware-and-appliances': 'Shopping',
  'health-and-medical': 'Bills',
  'holidays-and-travel': 'Shopping',
  'news-magazines-and-books': 'Bills',
  'games-and-software': 'Bills',

  'education-and-student-loans': 'Bills',
  'fitness-and-wellbeing': 'Bills',
  'hair-and-beauty': 'Shopping',
  'car-insurance-and-maintenance': 'Bills',
  'home-insurance-and-rates': 'Bills',
  'rent-and-mortgage': 'Rent',
  'utilities': 'Bills',
  'life-admin': 'Bills',
  'tobacco-and-vaping': 'Shopping',
  'lottery-and-gambling': 'Shopping',
  'pets': 'Shopping',
  'gifts-and-charity': 'Shopping',
}

function ruleCategorize(
  description: string,
  merchant: string | null,
  isTransfer: boolean,
  raw: any,
  userCategories: any[]
): { categoryId: string | null; source: string } {
  // Transfer detection
  if (isTransfer) {
    const transferCat = userCategories.find((c: any) => c.type === 'transfer' || c.name.toLowerCase() === 'transfers');
    if (transferCat) return { categoryId: transferCat.id, source: 'rule' };
  }

  const upper = (description + ' ' + (merchant || '')).toUpperCase();

  // 1. Exact keyword matching
  for (const [catName, keywords] of Object.entries(CATEGORY_RULES)) {
    if (keywords.some(kw => upper.includes(kw))) {
      const cat = userCategories.find((c: any) => c.name === catName);
      if (cat) return { categoryId: cat.id, source: 'rule' };
    }
  }

  // 2. Up Bank category hint from raw data
  if (raw && typeof raw === 'object') {
    const upCat = raw.category || raw.parentCategory;
    if (upCat && UP_CATEGORY_MAP[upCat]) {
      const mappedName = UP_CATEGORY_MAP[upCat];
      const cat = userCategories.find((c: any) => c.name === mappedName);
      if (cat) return { categoryId: cat.id, source: 'up_hint' };
    }
  }

  return { categoryId: null, source: '' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Support both user auth and service-role auth (for cron)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const isServiceRole = token === serviceRoleKey

    let supabase: any
    let userId: string

    if (isServiceRole) {
      // Called from cron — expect user_id in body
      const body = await req.json().catch(() => ({}))
      if (!body.user_id) {
        return new Response(JSON.stringify({ error: 'user_id required for service role calls' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      userId = body.user_id
      supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        serviceRoleKey,
      )
    } else {
      supabase = createClient(
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
      userId = userData.user.id
    }

    // Fetch user's categories
    const { data: categories, error: catErr } = await supabase
      .from('finance_categories')
      .select('id, name, type, is_cuttable')
      .eq('user_id', userId)

    if (catErr || !categories || categories.length === 0) {
      return new Response(JSON.stringify({ error: 'No categories found. Create categories first.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Detect recurring (monthly) merchants across ALL user transactions so we can
    // route them to Bills and avoid double-counting against Fixed Bills.
    const { data: allTxs } = await supabase
      .from('finance_transactions')
      .select('description, merchant, amount, posted_at')
      .eq('user_id', userId)
      .lt('amount', 0)
      .order('posted_at', { ascending: false })
      .limit(2000)

    const normalizeKey = (desc: string, merch: string | null) => {
      const base = (merch || desc || '').toLowerCase()
      return base.replace(/[^a-z0-9]+/g, ' ').replace(/\b\d{2,}\b/g, '').trim().slice(0, 40)
    }

    const recurringKeys = new Set<string>()
    if (allTxs && allTxs.length > 0) {
      const groups = new Map<string, { dates: number[]; amounts: number[] }>()
      for (const t of allTxs) {
        const k = normalizeKey(t.description || '', t.merchant)
        if (!k) continue
        const g = groups.get(k) || { dates: [], amounts: [] }
        g.dates.push(new Date(t.posted_at).getTime())
        g.amounts.push(Math.abs(Number(t.amount) || 0))
        groups.set(k, g)
      }
      for (const [k, g] of groups) {
        if (g.dates.length < 2) continue
        g.dates.sort((a, b) => a - b)
        // Check consecutive gaps look monthly (20-40 days) at least twice, OR ≥3 occurrences
        let monthlyGaps = 0
        for (let i = 1; i < g.dates.length; i++) {
          const gapDays = (g.dates[i] - g.dates[i - 1]) / 86400000
          if (gapDays >= 20 && gapDays <= 40) monthlyGaps++
        }
        if (monthlyGaps >= 2 || (monthlyGaps >= 1 && g.dates.length >= 3)) {
          recurringKeys.add(k)
        }
      }
    }

    // Fetch uncategorised transactions (newest first, limit 500)
    const { data: uncatTxs, error: txErr } = await supabase
      .from('finance_transactions')
      .select('id, description, merchant, amount, is_transfer, external_transaction_id, raw')
      .eq('user_id', userId)
      .is('category_id', null)
      .order('posted_at', { ascending: false })
      .limit(500)

    if (txErr) {
      return new Response(JSON.stringify({ error: 'Failed to fetch transactions' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!uncatTxs || uncatTxs.length === 0) {
      return new Response(JSON.stringify({ categorized: 0, rule: 0, ai: 0, message: 'All transactions already categorised.' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // First pass: rule-based + Up hints + recurring→Bills
    const ruleResults: { id: string; category_id: string }[] = []
    const remaining: typeof uncatTxs = []
    const incomeCat = categories.find((c: any) => c.type === 'income' || c.name.toLowerCase() === 'income')
    const billsCat = categories.find((c: any) => c.name.toLowerCase() === 'bills')

    for (const tx of uncatTxs) {
      // Income detection
      if (tx.amount > 0 && !tx.is_transfer && incomeCat) {
        ruleResults.push({ id: tx.id, category_id: incomeCat.id })
        continue
      }

      // Recurring monthly → Bills (avoids double-counting alongside Fixed Bills)
      if (billsCat && !tx.is_transfer && tx.amount < 0) {
        const k = normalizeKey(tx.description || '', tx.merchant)
        if (k && recurringKeys.has(k)) {
          ruleResults.push({ id: tx.id, category_id: billsCat.id })
          continue
        }
      }

      const result = ruleCategorize(tx.description, tx.merchant, tx.is_transfer, tx.raw, categories)
      if (result.categoryId) {
        ruleResults.push({ id: tx.id, category_id: result.categoryId })
      } else {
        remaining.push(tx)
      }
    }


    // Batch update rule-categorised using RPC for performance
    let ruleCount = 0
    if (ruleResults.length > 0) {
      const { data: affected, error: rpcErr } = await supabase.rpc('apply_transaction_categories', {
        updates: ruleResults,
      })
      if (rpcErr) {
        console.error('RPC bulk update failed, falling back to individual:', rpcErr.message)
        for (const r of ruleResults) {
          const { error } = await supabase
            .from('finance_transactions')
            .update({ category_id: r.category_id })
            .eq('id', r.id)
          if (!error) ruleCount++
        }
      } else {
        ruleCount = affected || ruleResults.length
      }
    }

    // Second pass: AI for leftovers (batches of 30)
    let aiCount = 0
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')

    if (remaining.length > 0 && LOVABLE_API_KEY) {
      const categoryList = categories.map((c: any) => `${c.name} (${c.type})`).join(', ')

      for (let i = 0; i < remaining.length; i += 30) {
        const batch = remaining.slice(i, i + 30)
        const txList = batch.map((tx, idx) => {
          const upCat = tx.raw?.category ? ` [bank_hint: ${tx.raw.category}]` : ''
          return `${idx + 1}. "${tx.description}"${tx.merchant ? ` merchant="${tx.merchant}"` : ''} amt=${tx.amount}${upCat}`
        }).join('\n')

        try {
          const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash-lite',
              messages: [
                {
                  role: 'system',
                  content: `You categorise bank transactions into spending categories. Available categories: ${categoryList}.

Rules:
- Match each transaction to the BEST category from the list
- Use the bank_hint field as a strong signal when available
- Common patterns: cafes/restaurants/pubs/takeaway → Eating Out; supermarkets → Groceries; trains/buses/rideshare → Transport; utilities/phone/insurance/rent/council → Bills
- IMPORTANT: any recurring monthly charge (streaming services, software, gym, phone plans, subscriptions of any kind) → Bills. Do NOT use "Subscriptions" for these — they are tracked under Fixed Bills and must go to Bills to avoid double counting.
- If the description clearly indicates a purchase type, categorise it even if it's ambiguous
- Only leave uncategorised (return null) if genuinely impossible to determine
- Negative amounts are spending, positive amounts should be "Income"


Return ONLY a JSON array: [{"index": 1, "category": "ExactCategoryName"}, ...]. No explanation.`,
                },
                {
                  role: 'user',
                  content: `Categorise:\n${txList}`,
                },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "categorize_transactions",
                    description: "Categorise a batch of transactions",
                    parameters: {
                      type: "object",
                      properties: {
                        results: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              index: { type: "number" },
                              category: { type: "string", nullable: true },
                            },
                            required: ["index", "category"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["results"],
                      additionalProperties: false,
                    },
                  },
                },
              ],
              tool_choice: { type: "function", function: { name: "categorize_transactions" } },
            }),
          })

          if (aiRes.status === 429 || aiRes.status === 402) {
            console.warn('AI rate limited or payment required, skipping AI pass')
            break
          }

          if (aiRes.ok) {
            const aiData = await aiRes.json()
            const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0]
            if (toolCall) {
              const parsed = JSON.parse(toolCall.function.arguments)
              const results = parsed.results || []

              const aiUpdates: { id: string; category_id: string }[] = []
              for (const r of results) {
                const tx = batch[r.index - 1]
                if (!tx || !r.category) continue
                const cat = categories.find((c: any) => c.name.toLowerCase() === r.category.toLowerCase())
                if (cat) {
                  aiUpdates.push({ id: tx.id, category_id: cat.id })
                }
              }

              if (aiUpdates.length > 0) {
                const { data: affected, error: rpcErr } = await supabase.rpc('apply_transaction_categories', {
                  updates: aiUpdates,
                })
                if (rpcErr) {
                  for (const u of aiUpdates) {
                    const { error } = await supabase
                      .from('finance_transactions')
                      .update({ category_id: u.category_id })
                      .eq('id', u.id)
                    if (!error) aiCount++
                  }
                } else {
                  aiCount += affected || aiUpdates.length
                }
              }
            }
          }
        } catch (aiErr) {
          console.error('AI categorization error:', aiErr)
        }
      }
    }

    return new Response(JSON.stringify({
      categorized: ruleCount + aiCount,
      rule: ruleCount,
      ai: aiCount,
      uncategorizedRemaining: remaining.length - aiCount,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('finance-categorize error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})