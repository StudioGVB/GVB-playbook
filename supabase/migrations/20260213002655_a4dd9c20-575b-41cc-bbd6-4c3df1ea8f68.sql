
-- Income source tags: map raw source keys to a business/group name
CREATE TABLE public.income_source_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_key TEXT NOT NULL,
  group_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Each user can only tag a source_key once
CREATE UNIQUE INDEX idx_income_source_tags_user_key ON public.income_source_tags (user_id, source_key);

ALTER TABLE public.income_source_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own income_source_tags"
  ON public.income_source_tags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own income_source_tags"
  ON public.income_source_tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own income_source_tags"
  ON public.income_source_tags FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own income_source_tags"
  ON public.income_source_tags FOR DELETE
  USING (auth.uid() = user_id);
