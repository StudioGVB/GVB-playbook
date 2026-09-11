import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const UP_API_BASE = 'https://api.up.com.au/api/v1'

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

    const upToken = Deno.env.get('UP_ACCESS_TOKEN')
    if (!upToken) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'missing_secret',
        message: 'UP_ACCESS_TOKEN not configured in Cloud Secrets.',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Test token and fetch accounts
    const accountsResponse = await fetch(`${UP_API_BASE}/accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${upToken}`,
        'Accept': 'application/json',
      },
    })

    if (!accountsResponse.ok) {
      if (accountsResponse.status === 401) {
        return new Response(JSON.stringify({
          connected: false,
          error: 'invalid_token',
          message: 'UP_ACCESS_TOKEN is invalid or expired. Regenerate it in the Up app.',
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        connected: false,
        error: 'api_error',
        message: `Up API returned status ${accountsResponse.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsResponse.json()
    const upAccounts = accountsData.data || []

    // Upsert Up accounts into finance_accounts so connection persists
    if (upAccounts.length > 0) {
      const rows = upAccounts.map((acc: any) => ({
        user_id: userId,
        provider: 'up',
        external_account_id: acc.id,
        account_name: acc.attributes?.displayName || 'Up Account',
        currency: acc.attributes?.balance?.currencyCode || 'AUD',
        balance: parseFloat(acc.attributes?.balance?.value || '0'),
      }))

      const { error: upsertError } = await supabase
        .from('finance_accounts')
        .upsert(rows, { onConflict: 'user_id,external_account_id' })

      if (upsertError) {
        console.error('Failed to upsert Up accounts:', upsertError.message)
      }
    }

    return new Response(JSON.stringify({
      connected: true,
      accountsCount: upAccounts.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in up-status:', (error as Error).message)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
