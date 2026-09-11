ALTER TABLE finance_assumptions ADD COLUMN target_savings numeric NOT NULL DEFAULT 0;

ALTER TABLE finance_categories ADD COLUMN is_essential boolean NOT NULL DEFAULT false;

CREATE TABLE finance_week_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  week_type text NOT NULL DEFAULT 'normal',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
ALTER TABLE finance_week_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own week types" ON finance_week_types
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);