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
    const rawToken = body.token || Deno.env.get('MONZO_ACCESS_TOKEN')

    if (!rawToken || typeof rawToken !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid token. Configure MONZO_ACCESS_TOKEN secret or pass it in request body.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      const errText = await accountsRes.text()
      console.error(`Monzo API error [${accountsRes.status}]:`, errText)
      return new Response(JSON.stringify({ error: `Monzo API error: ${accountsRes.status}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsRes.json()
    const accounts = accountsData.accounts || []

    if (accounts.length === 0) {
      return new Response(JSON.stringify({ error: 'No Monzo accounts found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Fetch balances for each account and map them
    const accountRows = []
    for (const acc of accounts) {
      // Fetch balance
      const balanceRes = await fetch(`https://api.monzo.com/balance?account_id=${acc.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      })

      let balanceVal = 0
      if (balanceRes.ok) {
        const balData = await balanceRes.json()
        // Monzo returns balance in minor units (pence), convert to main units (pounds)
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

    // 3. Upsert accounts in database
    if (accountRows.length > 0) {
      const { error: upsertError } = await supabase
        .from('finance_accounts')
        .upsert(accountRows, {
          onConflict: 'user_id,external_account_id',
          ignoreDuplicates: false,
        })

      if (upsertError) {
        console.error('Monzo accounts upsert failed:', upsertError.message)
        return new Response(JSON.stringify({ error: 'Failed to save account connections' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 4. Persist the token in public.finance_settings
    try {
      const { data: settingsData } = await supabase
        .from('finance_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      const bankTokens = settingsData?.bank_tokens || {}
      bankTokens.monzo = token

      await supabase
        .from('finance_settings')
        .upsert({
          user_id: userId,
          bank_tokens: bankTokens,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
    } catch (persistErr) {
      console.error('Failed to persist Monzo token in settings:', persistErr)
      // Non-blocking error, since accounts were saved successfully
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Monzo connected successfully',
      accountsSynced: accountRows.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in monzo-connect:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
