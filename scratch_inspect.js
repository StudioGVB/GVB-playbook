import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://wlaydyjeilhinngtnnbd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hwLBVLLUZAsgh7xI6GNSGw_Nc0XFxbg";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspect() {
  console.log('=== INSPECTING SUPABASE DATABASE ===');
  
  // 1. Query accounts
  const { data: accounts, error: accErr } = await supabase
    .from('finance_accounts')
    .select('*');

  console.log('\n--- FINANCE ACCOUNTS ---');
  if (accErr) {
    console.error('Error fetching accounts:', accErr);
  } else {
    console.log(`Found ${accounts.length} account(s):`);
    accounts.forEach(a => {
      console.log(`- ID: ${a.id} | Name: "${a.account_name}" | Provider: "${a.provider}" | Currency: ${a.currency} | ExcludeFromTotals: ${a.exclude_from_totals} | ExtID: ${a.external_account_id}`);
    });
  }

  // 2. Query transactions count
  const { data: txs, error: txErr, count } = await supabase
    .from('finance_transactions')
    .select('id, account_id, description, amount, posted_at, is_transfer, category_id', { count: 'exact' })
    .order('posted_at', { ascending: false })
    .limit(100);

  console.log('\n--- FINANCE TRANSACTIONS ---');
  if (txErr) {
    console.error('Error fetching transactions:', txErr);
  } else {
    console.log(`Total transactions returned in limit(100): ${txs ? txs.length : 0} (total count: ${count})`);
    
    // Group txs by account_id
    const txByAcc = {};
    (txs || []).forEach(t => {
      txByAcc[t.account_id] = (txByAcc[t.account_id] || 0) + 1;
    });

    console.log('Transactions count per account_id (in top 100):');
    Object.entries(txByAcc).forEach(([accId, cnt]) => {
      const matchedAcc = accounts?.find(a => a.id === accId);
      console.log(`  Account: ${matchedAcc ? matchedAcc.account_name : accId} (Provider: ${matchedAcc ? matchedAcc.provider : 'unknown'}) -> ${cnt} transactions`);
    });

    console.log('\nFirst 15 transactions snippet:');
    (txs || []).slice(0, 15).forEach(t => {
      const acc = accounts?.find(a => a.id === t.account_id);
      console.log(`  [${t.posted_at?.slice(0,10)}] ${t.amount} | ${t.description} (Acc: ${acc ? acc.account_name : t.account_id}, Provider: ${acc ? acc.provider : 'unk'}, is_transfer: ${t.is_transfer})`);
    });
  }
}

inspect().catch(err => console.error('Script error:', err));
