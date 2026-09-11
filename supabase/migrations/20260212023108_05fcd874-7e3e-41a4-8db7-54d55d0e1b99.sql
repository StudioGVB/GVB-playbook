-- Add unique constraint for account upsert by external ID
CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_user_id_external_account_id_key
ON public.finance_accounts (user_id, external_account_id)
WHERE external_account_id IS NOT NULL;