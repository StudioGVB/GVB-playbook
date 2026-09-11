CREATE TABLE public.finance_weekly_boosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.finance_goals(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  week_start date NOT NULL,
  note text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_weekly_boosts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own boosts" ON public.finance_weekly_boosts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own boosts" ON public.finance_weekly_boosts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own boosts" ON public.finance_weekly_boosts FOR DELETE USING (auth.uid() = user_id);