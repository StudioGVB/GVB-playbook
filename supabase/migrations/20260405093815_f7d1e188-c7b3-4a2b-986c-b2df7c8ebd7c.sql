ALTER TABLE public.finance_assumptions
  ADD COLUMN carry_forward_debt numeric NOT NULL DEFAULT 0,
  ADD COLUMN last_debt_week date;