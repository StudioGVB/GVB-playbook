-- Add work reimbursement columns to finance_transactions
ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reimbursement_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reimbursed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reimbursement_payout_id uuid NULL;

-- Create index for filtering reimbursable transactions
CREATE INDEX IF NOT EXISTS idx_finance_tx_reimbursable
  ON public.finance_transactions (user_id, is_reimbursable)
  WHERE is_reimbursable = true;
