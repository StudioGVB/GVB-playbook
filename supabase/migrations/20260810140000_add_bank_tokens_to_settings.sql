ALTER TABLE public.finance_settings 
ADD COLUMN IF NOT EXISTS bank_tokens jsonb DEFAULT '{}'::jsonb;
