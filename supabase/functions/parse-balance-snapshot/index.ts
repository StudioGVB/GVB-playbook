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

    const { image_base64, mime_type, existing_accounts } = await req.json()

    if (!image_base64) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build account context for matching
    const accountList = (existing_accounts || [])
      .map((a: any) => `- "${a.account_name}" (${a.currency}, provider: ${a.provider}, id: ${a.id})`)
      .join('\n')

    const systemPrompt = `You are a financial data extraction assistant. You will receive a screenshot or photo of a banking app or website showing account balances.

Extract ALL visible account names and their current balances.

IMPORTANT: Match each extracted account to the closest existing account from this list:
${accountList}

Return a JSON array of objects with these fields:
- "account_id": the id from the existing accounts list that best matches (or null if no match)
- "extracted_name": the account name as shown in the image
- "balance": the numeric balance (positive number, no currency symbols)
- "currency": the currency code (e.g. "AUD", "GBP")
- "confidence": "high", "medium", or "low"
- "match_reason": brief explanation of why you matched to that account

Rules:
- Parse numbers carefully: "$1,234.56" = 1234.56
- If an account shows multiple balances (available vs current), use the available balance
- Match accounts by name similarity (e.g. "Spending" matches "Spending", "2Up Spending" matches "2Up Spending")
- If you can't confidently match, set account_id to null
- Include ALL accounts visible in the image`

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mime_type || 'image/jpeg'};base64,${image_base64}`,
                },
              },
              {
                type: 'text',
                text: 'Extract all account names and balances from this banking screenshot. Return ONLY a JSON array, no markdown.',
              },
            ],
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_balances',
              description: 'Extract account balances from a banking screenshot',
              parameters: {
                type: 'object',
                properties: {
                  accounts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        account_id: { type: 'string', description: 'Matched account ID from existing accounts, or null' },
                        extracted_name: { type: 'string', description: 'Account name as shown in image' },
                        balance: { type: 'number', description: 'Account balance as a number' },
                        currency: { type: 'string', description: 'Currency code' },
                        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                        match_reason: { type: 'string', description: 'Why this was matched' },
                      },
                      required: ['extracted_name', 'balance', 'currency', 'confidence'],
                    },
                  },
                },
                required: ['accounts'],
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_balances' } },
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited — please try again in a moment' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const errText = await response.text()
      console.error('AI gateway error:', response.status, errText)
      return new Response(JSON.stringify({ error: 'AI extraction failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const aiResult = await response.json()

    // Extract tool call result
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: 'AI did not return structured data' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const extracted = JSON.parse(toolCall.function.arguments)

    return new Response(JSON.stringify({
      success: true,
      accounts: extracted.accounts || [],
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('parse-balance-snapshot error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
