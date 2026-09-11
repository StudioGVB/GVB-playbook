-- Add import_log_id to finance_transactions to track which import created each transaction
ALTER TABLE public.finance_transactions 
ADD COLUMN import_log_id UUID REFERENCES public.finance_import_logs(id) ON DELETE CASCADE;