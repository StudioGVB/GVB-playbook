ALTER TABLE public.finance_transactions
ADD COLUMN fixed_expense_id uuid REFERENCES public.finance_fixed_expenses(id) ON DELETE SET NULL DEFAULT NULL;