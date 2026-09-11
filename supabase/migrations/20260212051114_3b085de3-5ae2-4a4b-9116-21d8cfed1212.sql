
-- A) Add source_type column to finance_accounts
ALTER TABLE public.finance_accounts
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual';

-- Set existing connected accounts to 'bank'
UPDATE public.finance_accounts
  SET source_type = 'bank'
  WHERE provider != 'manual' OR external_account_id IS NOT NULL;

-- C) Create bulk update RPC for transaction categories
CREATE OR REPLACE FUNCTION public.apply_transaction_categories(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE finance_transactions ft
  SET category_id = u.category_id::uuid
  FROM jsonb_to_recordset(updates) AS u(id uuid, category_id text)
  WHERE ft.id = u.id
    AND ft.user_id = auth.uid();
  
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
