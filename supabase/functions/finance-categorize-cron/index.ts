import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

serve(async (_req) => {
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Find every user that has at least one uncategorised transaction
    const { data: rows, error } = await supabase
      .from('finance_transactions')
      .select('user_id')
      .is('category_id', null)
      .limit(5000)

    if (error) {
      console.error('Failed to fetch uncategorised users:', error.message)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    const userIds = [...new Set((rows || []).map((r: any) => r.user_id))]
    console.log(`Auto-categorise cron: ${userIds.length} user(s) with uncategorised transactions`)

    const results: Array<{ userId: string; categorized?: number; rule?: number; ai?: number; error?: string }> = []

    for (const userId of userIds) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/finance-categorize`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          results.push({ userId, categorized: data.categorized, rule: data.rule, ai: data.ai })
          console.log(`Categorised ${userId}: ${data.categorized} (${data.rule} rules, ${data.ai} AI)`)
        } else {
          results.push({ userId, error: data.error || `HTTP ${res.status}` })
        }
      } catch (err) {
        console.error(`Categorise failed for ${userId}:`, err)
        results.push({ userId, error: String(err) })
      }
    }

    return new Response(JSON.stringify({ success: true, users: userIds.length, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('finance-categorize-cron error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }
})
