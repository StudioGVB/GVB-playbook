-- Set paid_externally = false on UK Flat fixed expense to remove the £720 reimbursement
UPDATE public.finance_fixed_expenses
SET paid_externally = false
WHERE name ILIKE '%UK Flat%' OR amount = 720;
