
-- Add transfer_status and transfer_pattern_key to finance_transactions
ALTER TABLE public.finance_transactions 
  ADD COLUMN IF NOT EXISTS transfer_status text DEFAULT NULL 
    CHECK (transfer_status IN ('suggested','confirmed','rejected','auto_confirmed')),
  ADD COLUMN IF NOT EXISTS transfer_pattern_key text DEFAULT NULL;

-- Create transfer_patterns table
CREATE TABLE IF NOT EXISTS public.transfer_patterns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  pattern_key text NOT NULL,
  account_from_id uuid NOT NULL REFERENCES public.finance_accounts(id) ON DELETE CASCADE,
  account_to_id uuid NOT NULL REFERENCES public.finance_accounts(id) ON DELETE CASCADE,
  typical_amount numeric NOT NULL,
  amount_tolerance numeric NOT NULL DEFAULT 0.01,
  frequency text NOT NULL DEFAULT 'irregular',
  confirmation_count integer NOT NULL DEFAULT 0,
  auto_match_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, pattern_key)
);

ALTER TABLE public.transfer_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transfer_patterns" ON public.transfer_patterns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own transfer_patterns" ON public.transfer_patterns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own transfer_patterns" ON public.transfer_patterns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own transfer_patterns" ON public.transfer_patterns FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tx_transfer_status ON public.finance_transactions(transfer_status);
CREATE INDEX IF NOT EXISTS idx_tx_transfer_pattern_key ON public.finance_transactions(transfer_pattern_key);
CREATE INDEX IF NOT EXISTS idx_tp_pattern_key ON public.transfer_patterns(pattern_key);
CREATE INDEX IF NOT EXISTS idx_tp_user_id ON public.transfer_patterns(user_id);
