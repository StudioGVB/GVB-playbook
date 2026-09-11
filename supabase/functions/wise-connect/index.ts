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
    const token = body.token || Deno.env.get('WISE_API_KEY')

    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid token. Configure WISE_API_KEY secret or pass it in request body.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Fetch profiles to test token
    const profilesRes = await fetch('https://api.wise.com/v1/profiles', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!profilesRes.ok) {
      const errText = await profilesRes.text()
      console.error(`Wise API error [${profilesRes.status}]:`, errText)
      return new Response(JSON.stringify({ error: `Wise API error: ${profilesRes.status}` }), {
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

    // Use the first profile (usually personal)
    const profile = profiles[0]
    const profileId = profile.id

    // 2. Fetch borderless accounts (balances)
    const balancesRes = await fetch(`https://api.wise.com/v4/profiles/${profileId}/balances?types=STANDARD`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!balancesRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch Wise balances: ${balancesRes.status}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const balances = await balancesRes.json()

    // 3. Upsert balances as accounts in the database
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
      const { error: upsertError } = await supabase
        .from('finance_accounts')
        .upsert(accountRows, {
          onConflict: 'user_id,external_account_id',
          ignoreDuplicates: false,
        })

      if (upsertError) {
        console.error('Wise accounts upsert failed:', upsertError.message)
        return new Response(JSON.stringify({ error: 'Failed to save account connections' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Wise connected successfully',
      profileId,
      accountsSynced: accountRows.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in wise-connect:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
