ALTER TABLE public.finance_fixed_expenses
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date;

CREATE INDEX IF NOT EXISTS idx_finance_fixed_expenses_effective
  ON public.finance_fixed_expenses (user_id, effective_from, effective_to);