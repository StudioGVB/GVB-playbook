import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1'

const MONZO_CLIENT_ID = Deno.env.get('MONZO_CLIENT_ID') || 'oauth2client_0000BAIUMhrA8jDgU6Ydmr';
const MONZO_CLIENT_SECRET = Deno.env.get('MONZO_CLIENT_SECRET') || 'mnzconf.JA9atqjwUDCgObnSS2gVRHUFrPSNRk6CdFAybM01d0fnxleruKXLQs07jpMb22CzbrfYBpT+5tD+7CjWJqugMA==';
const REDIRECT_URI = 'https://wlaydyjeilhinngtnnbd.supabase.co/functions/v1/monzo-callback';

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return new Response('Missing authorization code from Monzo', { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: MONZO_CLIENT_ID,
      client_secret: MONZO_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    });

    const tokenRes = await fetch('https://api.monzo.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Monzo token exchange failed:', errText);
      return new Response(`Monzo OAuth exchange failed: ${errText}`, { status: 400 });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 21600;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!
    );

    if (state) {
      const { data: settingsData } = await supabaseAdmin
        .from('finance_settings')
        .select('bank_tokens')
        .eq('user_id', state)
        .maybeSingle();

      const bankTokens = settingsData?.bank_tokens || {};
      bankTokens.monzo = accessToken;
      bankTokens.monzo_refresh = refreshToken;
      bankTokens.monzo_expires_at = Date.now() + (expiresIn * 1000);

      await supabaseAdmin.from('finance_settings').upsert({
        user_id: state,
        bank_tokens: bankTokens,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      // Discover and sync Monzo accounts immediately
      try {
        const accountsRes = await fetch('https://api.monzo.com/accounts', {
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
        });
        if (accountsRes.ok) {
          const accountsData = await accountsRes.json();
          const accounts = accountsData.accounts || [];
          const accountRows = [];
          for (const acc of accounts) {
            const balanceRes = await fetch(`https://api.monzo.com/balance?account_id=${acc.id}`, {
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
            });
            let balanceVal = 0;
            if (balanceRes.ok) {
              const balData = await balanceRes.json();
              balanceVal = (balData.balance || 0) / 100;
            }
            accountRows.push({
              user_id: state,
              provider: 'monzo',
              account_name: acc.description || `Monzo ${acc.type || 'Account'}`,
              currency: acc.currency || 'GBP',
              balance: balanceVal,
              external_account_id: String(acc.id),
              last_synced_at: new Date().toISOString(),
              source_type: 'bank',
            });
          }
          if (accountRows.length > 0) {
            await supabaseAdmin.from('finance_accounts').upsert(accountRows, {
              onConflict: 'user_id,external_account_id',
            });
          }
        }
      } catch (syncErr) {
        console.error('Initial Monzo account sync error in callback:', syncErr);
      }
    }

    // Redirect user back to GVB Playbook Accounts page
    const appBaseUrl = Deno.env.get('APP_URL') || 'http://localhost:8081';
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${appBaseUrl}/finance/accounts?monzo_connected=true`,
      },
    });
  } catch (err: any) {
    console.error('Error in monzo-callback:', err);
    return new Response(`Internal server error: ${err.message}`, { status: 500 });
  }
});
