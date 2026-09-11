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

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = userData.user.id

    const token = Deno.env.get('WISE_API_KEY')
    if (!token) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'missing_secret',
        message: 'WISE_API_KEY not configured in Cloud Secrets.',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      if (profilesRes.status === 401) {
        return new Response(JSON.stringify({
          connected: false,
          error: 'invalid_token',
          message: 'WISE_API_KEY is invalid or expired.',
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        connected: false,
        error: 'api_error',
        message: `Wise API returned status ${profilesRes.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const profiles = await profilesRes.json()
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'no_profiles',
        message: 'No Wise profiles found.',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const profileId = profiles[0].id

    // 2. Fetch balances
    const balancesRes = await fetch(`https://api.wise.com/v4/profiles/${profileId}/balances?types=STANDARD`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!balancesRes.ok) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'api_error',
        message: `Failed to fetch Wise balances: status ${balancesRes.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const balances = await balancesRes.json()

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
    }))

    if (accountRows.length > 0) {
      const { error: upsertError } = await supabase
        .from('finance_accounts')
        .upsert(accountRows, { onConflict: 'user_id,external_account_id' })

      if (upsertError) {
        console.error('Failed to upsert Wise accounts:', upsertError.message)
      }
    }

    return new Response(JSON.stringify({
      connected: true,
      accountsCount: accountRows.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in wise-status:', (error as Error).message)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
