
-- Add assigned_amount column to finance_goals for virtual savings allocation
ALTER TABLE public.finance_goals
ADD COLUMN IF NOT EXISTS assigned_amount numeric NOT NULL DEFAULT 0;

-- Add updated_at column to finance_goals
ALTER TABLE public.finance_goals
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Add constraint: assigned_amount must be non-negative (via trigger for safety)
CREATE OR REPLACE FUNCTION public.validate_goal_assigned_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_amount < 0 THEN
    RAISE EXCEPTION 'assigned_amount cannot be negative';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_goal_assigned_amount_trigger
BEFORE INSERT OR UPDATE ON public.finance_goals
FOR EACH ROW
EXECUTE FUNCTION public.validate_goal_assigned_amount();
