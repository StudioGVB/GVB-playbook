
-- Add transfer pairing columns to finance_transactions
ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid NULL,
  ADD COLUMN IF NOT EXISTS transfer_side text NULL CHECK (transfer_side IN ('in', 'out')),
  ADD COLUMN IF NOT EXISTS transfer_match_confidence integer NULL,
  ADD COLUMN IF NOT EXISTS matched_transaction_id uuid NULL;

-- Indexes for efficient matching
CREATE INDEX IF NOT EXISTS idx_ft_account_posted ON public.finance_transactions (account_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_ft_abs_amount_posted ON public.finance_transactions (amount, posted_at);
CREATE INDEX IF NOT EXISTS idx_ft_is_transfer_posted ON public.finance_transactions (is_transfer, posted_at);
CREATE INDEX IF NOT EXISTS idx_ft_transfer_group ON public.finance_transactions (transfer_group_id);
