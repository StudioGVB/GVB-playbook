-- Fix currency for Monzo accounts in finance_accounts to default to GBP
UPDATE public.finance_accounts
SET currency = 'GBP'
WHERE provider = 'monzo' AND (currency IS NULL OR currency = 'AUD');

-- Ensure all monzo accounts have source_type = 'bank'
UPDATE public.finance_accounts
SET source_type = 'bank'
WHERE provider = 'monzo' AND (source_type IS NULL OR source_type = 'manual');
