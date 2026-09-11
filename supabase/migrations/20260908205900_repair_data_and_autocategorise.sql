-- 1. Copy fixed expenses from gabriellablyth@me.com to hello@studiogvb.com if missing
DO $$
DECLARE
  u1_id uuid := '5776c856-917a-40d9-9216-0c525c352a71';
  u2_id uuid := '63299e5b-7644-466d-ba2a-afe7bde1dae1';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = u2_id) THEN
    INSERT INTO public.finance_fixed_expenses (user_id, name, amount, frequency, currency, notes, due_day, auto_pay, paid_externally)
    SELECT u2_id, name, amount, frequency, currency, notes, due_day, auto_pay, paid_externally
    FROM public.finance_fixed_expenses
    WHERE user_id = u1_id
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 2. Auto-categorize transactions for both users
UPDATE public.finance_transactions t
SET category_id = c.id
FROM public.finance_categories c
WHERE t.user_id = c.user_id
  AND t.category_id IS NULL
  AND t.is_transfer = false
  AND (
    (LOWER(c.name) = 'groceries' AND (t.description ILIKE '%sainsbury%' OR t.description ILIKE '%lidl%' OR t.description ILIKE '%nisa%' OR t.description ILIKE '%city market%' OR t.merchant ILIKE '%sainsbury%' OR t.merchant ILIKE '%lidl%')) OR
    (LOWER(c.name) = 'eating out' AND (t.description ILIKE '%sugo%' OR t.description ILIKE '%costa%' OR t.description ILIKE '%mcdonald%' OR t.description ILIKE '%taco bell%' OR t.description ILIKE '%subway%' OR t.description ILIKE '%greggs%' OR t.description ILIKE '%black sheep%' OR t.description ILIKE '%top cut%' OR t.description ILIKE '%revolution%' OR t.merchant ILIKE '%sugo%' OR t.merchant ILIKE '%costa%')) OR
    (LOWER(c.name) = 'transport' AND (t.description ILIKE '%voi%' OR t.description ILIKE '%manchester piccadilly%' OR t.description ILIKE '%transport scotland%' OR t.description ILIKE '%nx newcastle%' OR t.description ILIKE '%uber%' OR t.merchant ILIKE '%voi%' OR t.merchant ILIKE '%beenetwork%')) OR
    (LOWER(c.name) = 'shopping' AND (t.description ILIKE '%amazon%' OR t.description ILIKE '%savers%' OR t.description ILIKE '%glossy apparel%' OR t.description ILIKE '%news 24%' OR t.merchant ILIKE '%amazon%')) OR
    (LOWER(c.name) = 'bills' AND (t.description ILIKE '%otter%' OR t.description ILIKE '%lyca%' OR t.description ILIKE '%vodafone%' OR t.merchant ILIKE '%otter%'))
  );
