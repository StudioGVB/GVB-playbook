import { createClient } from './node_modules/@supabase/supabase-js/dist/index.mjs';

const SUPABASE_URL = "https://wlaydyjeilhinngtnnbd.supabase.co";
const SUPABASE_KEY = "sb_publishable_hwLBVLLUZAsgh7xI6GNSGw_Nc0XFxbg";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('*')
    .ilike('description', '%easyjet%');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Found easyJet transactions:', JSON.stringify(data, null, 2));
}

run();
