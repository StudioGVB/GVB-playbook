
-- Multi-trip support
CREATE TABLE public.finance_trips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Trip',
  start_date DATE,
  end_date DATE,
  goal_id UUID,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trips" ON public.finance_trips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own trips" ON public.finance_trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own trips" ON public.finance_trips FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own trips" ON public.finance_trips FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_finance_trips_updated_at
  BEFORE UPDATE ON public.finance_trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_finance_trips_user ON public.finance_trips(user_id);
CREATE INDEX idx_finance_trips_dates ON public.finance_trips(user_id, start_date, end_date);

-- Tag transactions to a specific trip
ALTER TABLE public.finance_transactions
  ADD COLUMN trip_id UUID;

CREATE INDEX idx_finance_transactions_trip ON public.finance_transactions(trip_id) WHERE trip_id IS NOT NULL;
