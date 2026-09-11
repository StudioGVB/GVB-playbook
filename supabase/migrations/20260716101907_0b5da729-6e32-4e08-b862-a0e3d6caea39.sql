
CREATE TYPE public.meal_category AS ENUM ('base', 'meat', 'side');

CREATE TABLE public.meal_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category public.meal_category NOT NULL,
  name TEXT NOT NULL,
  pack_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  pack_currency TEXT NOT NULL DEFAULT 'GBP',
  servings_per_pack NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (servings_per_pack > 0),
  calories_per_serving INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_ingredients TO authenticated;
GRANT ALL ON public.meal_ingredients TO service_role;

ALTER TABLE public.meal_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own meal ingredients"
  ON public.meal_ingredients FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER meal_ingredients_updated_at
  BEFORE UPDATE ON public.meal_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX meal_ingredients_user_cat_idx ON public.meal_ingredients(user_id, category);

CREATE TABLE public.meal_combos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_id UUID REFERENCES public.meal_ingredients(id) ON DELETE SET NULL,
  meat_id UUID REFERENCES public.meal_ingredients(id) ON DELETE SET NULL,
  side_id UUID REFERENCES public.meal_ingredients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_combos TO authenticated;
GRANT ALL ON public.meal_combos TO service_role;

ALTER TABLE public.meal_combos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own meal combos"
  ON public.meal_combos FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER meal_combos_updated_at
  BEFORE UPDATE ON public.meal_combos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX meal_combos_user_idx ON public.meal_combos(user_id);
