
-- Create finance_assumptions table (one row per user)
CREATE TABLE public.finance_assumptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  future_monthly_survival_cost numeric NOT NULL DEFAULT 0,
  buffer_months integer NOT NULL DEFAULT 3,
  weekly_fun_budget numeric NOT NULL DEFAULT 0,
  expected_monthly_income numeric NULL,
  discretionary_savings_cap numeric NOT NULL DEFAULT 0,
  discretionary_start_date date NULL,
  discretionary_end_date date NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT one_per_user UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.finance_assumptions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own assumptions" ON public.finance_assumptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own assumptions" ON public.finance_assumptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own assumptions" ON public.finance_assumptions FOR UPDATE USING (auth.uid() = user_id);
