
CREATE TABLE public.finance_fixed_expense_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fixed_expense_id UUID NOT NULL REFERENCES public.finance_fixed_expenses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  amount NUMERIC NOT NULL,
  paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Prevent duplicate payments for the same expense in the same period
CREATE UNIQUE INDEX idx_fixed_payment_unique ON public.finance_fixed_expense_payments(fixed_expense_id, period_start);

ALTER TABLE public.finance_fixed_expense_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fixed expense payments"
  ON public.finance_fixed_expense_payments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own fixed expense payments"
  ON public.finance_fixed_expense_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own fixed expense payments"
  ON public.finance_fixed_expense_payments FOR DELETE
  USING (auth.uid() = user_id);
