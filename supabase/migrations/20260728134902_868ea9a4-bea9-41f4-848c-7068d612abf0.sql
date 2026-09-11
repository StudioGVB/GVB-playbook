ALTER TABLE public.finance_assumptions
  ADD COLUMN IF NOT EXISTS gross_annual_salary numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS student_loan_plan text;