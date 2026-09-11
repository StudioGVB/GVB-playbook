ALTER TABLE public.finance_accounts
  ADD COLUMN IF NOT EXISTS exclude_from_totals boolean NOT NULL DEFAULT false;

UPDATE public.finance_accounts
SET exclude_from_totals = true
WHERE id IN (
  '381456d6-495a-4de7-bb6d-7c7f8b92f587',
  '2873db03-2f3d-40e7-b5b5-9259778785cc'
);