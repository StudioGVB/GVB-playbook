import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

if (Deno.env.get('_HANDLER') === 'OPTIONS') {
  serve(() => new Response(null, { headers: corsHeaders }))
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
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = data.user.id
    const body = await req.json()
    const { token } = body

    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Test token by calling Up API
    const testResponse = await fetch('https://api.up.com.au/api/v1/accounts', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!testResponse.ok) {
      const errorText = await testResponse.text()
      console.error(`Up API error [${testResponse.status}]:`, errorText)
      
      if (testResponse.status === 401) {
        return new Response(JSON.stringify({ error: 'Invalid or expired Up token' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'Failed to connect to Up. Please check your token and try again.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await testResponse.json()

    // Token storage (Option A - Simple & Secure):
    // Token is stored as Supabase Edge Function secret in Lovable Cloud
    // User sets it via: Settings → Secrets → UP_ACCESS_TOKEN = <token>
    // Sync functions access it via: Deno.env.get('UP_ACCESS_TOKEN')
    // Token never stored in database, never logged, never exposed to client
    
    // Create or update the Up account record
    const { error: upsertError } = await supabase
      .from('finance_accounts')
      .upsert([{
        user_id: userId,
        provider: 'up',
        account_name: 'Up Bank',
        currency: 'AUD',
        balance: 0,
        last_synced_at: new Date().toISOString(),
      }], {
        onConflict: 'user_id,provider',
        ignoreDuplicates: false,
      })

    if (upsertError) {
      console.error('Upsert error:', upsertError)
      return new Response(JSON.stringify({ error: 'Failed to save account connection' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Up Bank connected successfully',
      accountsCount: accountsData.data?.length || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in up-connect:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
