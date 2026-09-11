-- Drop the partial unique index that doesn't work with upsert
DROP INDEX IF EXISTS public.finance_accounts_user_id_external_account_id_key;

-- Create a proper unique index (without WHERE clause) for upsert compatibility
CREATE UNIQUE INDEX finance_accounts_user_id_external_account_id_key
  ON public.finance_accounts (user_id, external_account_id);
