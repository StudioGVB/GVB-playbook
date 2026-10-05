import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://wlaydyjeilhinngtnnbd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hwLBVLLUZAsgh7xI6GNSGw_Nc0XFxbg";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspect() {
  console.log('=== INSPECTING DUPES IN FINANCE TRANSACTIONS ===');

  const { data: accounts } = await supabase.from('finance_accounts').select('*');
  console.log('Accounts:', accounts?.map(a => ({ id: a.id, name: a.account_name, provider: a.provider, currency: a.currency })));

  const { data: txs, error } = await supabase
    .from('finance_transactions')
    .select('id, user_id, account_id, external_transaction_id, posted_at, description, merchant, amount, currency, is_transfer, transaction_fingerprint')
    .order('posted_at', { ascending: false });

  if (error) {
    console.error('Error fetching txs:', error);
    return;
  }

  console.log(`\nFound ${txs.length} total transactions in DB.`);
  
  // Look for the 3k items and 720 rent items
  const OctTxs = txs.filter(t => t.posted_at?.startsWith('2026-10-01') || Math.abs(t.amount) === 3000 || Math.abs(t.amount) === 720);
  
  console.log('\n--- 3K AND RENT TRANSACTIONS (OCT 2026) ---');
  OctTxs.forEach(t => {
    const acc = accounts?.find(a => a.id === t.account_id);
    console.log(`ID: ${t.id}`);
    console.log(`  Account: ${acc ? acc.account_name : t.account_id} (${acc?.provider})`);
    console.log(`  Posted: ${t.posted_at} | Amount: ${t.amount} ${t.currency}`);
    console.log(`  Desc: "${t.description}" | Merchant: "${t.merchant}"`);
    console.log(`  ExtTxID: "${t.external_transaction_id}" | Fingerprint: "${t.transaction_fingerprint}"`);
    console.log('---');
  });
}

inspect();
