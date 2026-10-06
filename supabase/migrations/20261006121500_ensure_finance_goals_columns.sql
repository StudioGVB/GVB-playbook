-- Migration to ensure all finance_goals columns exist
ALTER TABLE public.finance_goals ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.finance_goals ADD COLUMN IF NOT EXISTS color text DEFAULT '#4558ff';
ALTER TABLE public.finance_goals ADD COLUMN IF NOT EXISTS is_stash boolean NOT NULL DEFAULT false;
ALTER TABLE public.finance_goals ADD COLUMN IF NOT EXISTS percent_allocation numeric DEFAULT 0;
ALTER TABLE public.finance_goals ADD COLUMN IF NOT EXISTS start_date date;
