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

    let rawToken = Deno.env.get('MONZO_ACCESS_TOKEN')

    if (!rawToken) {
      // Query finance_settings table
      try {
        const { data: settingsData } = await supabase
          .from('finance_settings')
          .select('bank_tokens')
          .eq('user_id', userId)
          .maybeSingle()

        if (settingsData?.bank_tokens?.monzo) {
          rawToken = settingsData.bank_tokens.monzo
        }
      } catch (err) {
        console.error('Failed to read Monzo token from database settings:', err)
      }
    }

    if (!rawToken) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'missing_secret',
        message: 'MONZO_ACCESS_TOKEN not configured in Cloud Secrets.',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = rawToken.replace(/\s+/g, '')

    // 1. Fetch accounts to test token
    const accountsRes = await fetch('https://api.monzo.com/accounts', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!accountsRes.ok) {
      if (accountsRes.status === 401) {
        return new Response(JSON.stringify({
          connected: false,
          error: 'invalid_token',
          message: 'MONZO_ACCESS_TOKEN is invalid or expired.',
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        connected: false,
        error: 'api_error',
        message: `Monzo API returned status ${accountsRes.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsRes.json()
    const accounts = accountsData.accounts || []

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
      const { error: upsertError } = await supabase
        .from('finance_accounts')
        .upsert(accountRows, { onConflict: 'user_id,external_account_id' })

      if (upsertError) {
        console.error('Failed to upsert Monzo accounts:', upsertError.message)
      }
    }

    return new Response(JSON.stringify({
      connected: true,
      accountsCount: accountRows.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in monzo-status:', (error as Error).message)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
