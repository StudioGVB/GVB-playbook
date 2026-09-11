-- Set base currency default to GBP for all users in finance_settings
UPDATE public.finance_settings
SET base_currency = 'GBP';
