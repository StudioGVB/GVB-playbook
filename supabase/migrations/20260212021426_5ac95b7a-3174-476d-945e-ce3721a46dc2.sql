
-- Finance Module: accounts, transactions, categories, budgets, goals, goal_plans

-- 1) accounts
CREATE TABLE public.finance_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  account_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  external_account_id TEXT,
  balance NUMERIC NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_accounts" ON public.finance_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_accounts" ON public.finance_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_accounts" ON public.finance_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance_accounts" ON public.finance_accounts FOR DELETE USING (auth.uid() = user_id);

-- 2) finance_categories
CREATE TABLE public.finance_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'variable',
  is_cuttable BOOLEAN NOT NULL DEFAULT true,
  monthly_target NUMERIC,
  weekly_target NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_categories" ON public.finance_categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_categories" ON public.finance_categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_categories" ON public.finance_categories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance_categories" ON public.finance_categories FOR DELETE USING (auth.uid() = user_id);

-- 3) finance_transactions
CREATE TABLE public.finance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES public.finance_accounts(id) ON DELETE CASCADE,
  external_transaction_id TEXT,
  posted_at TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  category_id UUID REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  is_transfer BOOLEAN NOT NULL DEFAULT false,
  is_fixed BOOLEAN NOT NULL DEFAULT false,
  is_reviewed BOOLEAN NOT NULL DEFAULT false,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, external_transaction_id)
);
ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_transactions" ON public.finance_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_transactions" ON public.finance_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_transactions" ON public.finance_transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance_transactions" ON public.finance_transactions FOR DELETE USING (auth.uid() = user_id);

-- Index for common queries
CREATE INDEX idx_finance_transactions_user_posted ON public.finance_transactions(user_id, posted_at DESC);
CREATE INDEX idx_finance_transactions_account ON public.finance_transactions(account_id);
CREATE INDEX idx_finance_transactions_category ON public.finance_transactions(category_id);

-- 4) finance_budgets
CREATE TABLE public.finance_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  month DATE NOT NULL,
  planned_income NUMERIC,
  fixed_budget NUMERIC,
  variable_budget NUMERIC,
  savings_goal NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, currency, month)
);
ALTER TABLE public.finance_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_budgets" ON public.finance_budgets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_budgets" ON public.finance_budgets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_budgets" ON public.finance_budgets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance_budgets" ON public.finance_budgets FOR DELETE USING (auth.uid() = user_id);

-- 5) finance_goals
CREATE TABLE public.finance_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  target_amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  deadline DATE,
  priority INT NOT NULL DEFAULT 2,
  safety_mode TEXT NOT NULL DEFAULT 'balanced',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_goals" ON public.finance_goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_goals" ON public.finance_goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_goals" ON public.finance_goals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance_goals" ON public.finance_goals FOR DELETE USING (auth.uid() = user_id);

-- 6) finance_goal_plans
CREATE TABLE public.finance_goal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.finance_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  baseline_weekly_surplus NUMERIC,
  suggested_weekly_savings NUMERIC,
  est_weeks_to_goal INT,
  plan JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_goal_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_goal_plans" ON public.finance_goal_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_goal_plans" ON public.finance_goal_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_goal_plans" ON public.finance_goal_plans FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own finance_goal_plans" ON public.finance_goal_plans FOR DELETE USING (auth.uid() = user_id);

-- 7) finance_settings (FX rate, etc.)
CREATE TABLE public.finance_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  fx_rates JSONB NOT NULL DEFAULT '{"AUD_GBP": 0.52, "GBP_AUD": 1.92}'::jsonb,
  base_currency TEXT NOT NULL DEFAULT 'AUD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own finance_settings" ON public.finance_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own finance_settings" ON public.finance_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own finance_settings" ON public.finance_settings FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_finance_settings_updated_at BEFORE UPDATE ON public.finance_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
