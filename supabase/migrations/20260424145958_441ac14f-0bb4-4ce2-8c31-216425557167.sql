-- Add travel mode columns to finance_assumptions
ALTER TABLE public.finance_assumptions
  ADD COLUMN IF NOT EXISTS travel_start_date date,
  ADD COLUMN IF NOT EXISTS travel_end_date date,
  ADD COLUMN IF NOT EXISTS travel_pool_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS travel_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Tag travel-pool spend on transactions
ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS is_travel_spend boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_is_travel_spend
  ON public.finance_transactions(user_id, is_travel_spend)
  WHERE is_travel_spend = true;