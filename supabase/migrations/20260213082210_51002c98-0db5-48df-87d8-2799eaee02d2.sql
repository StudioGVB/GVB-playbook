
-- Add baseline_savings_percent to finance_assumptions
ALTER TABLE public.finance_assumptions
  ADD COLUMN IF NOT EXISTS baseline_savings_percent numeric NOT NULL DEFAULT 10;

-- Add percent_allocation to finance_goals
ALTER TABLE public.finance_goals
  ADD COLUMN IF NOT EXISTS percent_allocation numeric NOT NULL DEFAULT 5;
