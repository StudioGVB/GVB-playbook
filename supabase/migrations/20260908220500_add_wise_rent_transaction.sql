-- Migration to add Wise AUD account and EVANS RENTAL MANAGEMENT rent transaction (-1367.56 AUD)

DO $$
DECLARE
  u RECORD;
  wise_acc_id uuid;
  rent_cat_id uuid;
  rent_fixed_id uuid;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    -- 1. Ensure Wise AUD account exists for this user
    SELECT id INTO wise_acc_id
    FROM public.finance_accounts
    WHERE user_id = u.id AND provider = 'wise' AND currency = 'AUD'
    LIMIT 1;

    IF wise_acc_id IS NULL THEN
      -- Try any Wise account for this user
      SELECT id INTO wise_acc_id
      FROM public.finance_accounts
      WHERE user_id = u.id AND provider = 'wise'
      LIMIT 1;
    END IF;

    IF wise_acc_id IS NULL THEN
      INSERT INTO public.finance_accounts (
        user_id,
        provider,
        account_name,
        currency,
        balance,
        source_type,
        external_account_id,
        last_synced_at
      ) VALUES (
        u.id,
        'wise',
        'Wise AUD',
        'AUD',
        0.00,
        'bank',
        'wise_aud_' || u.id,
        NOW()
      )
      RETURNING id INTO wise_acc_id;
    END IF;

    -- 2. Find Rent category and Rent fixed expense for user
    SELECT id INTO rent_cat_id
    FROM public.finance_categories
    WHERE user_id = u.id AND LOWER(name) = 'rent'
    LIMIT 1;

    SELECT id INTO rent_fixed_id
    FROM public.finance_fixed_expenses
    WHERE user_id = u.id AND LOWER(name) LIKE '%rent%'
    LIMIT 1;

    -- 3. Insert Wise Rent Transaction (-1,367.56 AUD on 2026-09-01)
    IF wise_acc_id IS NOT NULL THEN
      INSERT INTO public.finance_transactions (
        user_id,
        account_id,
        external_transaction_id,
        posted_at,
        description,
        merchant,
        amount,
        currency,
        category_id,
        is_fixed,
        fixed_expense_id,
        is_transfer,
        is_reviewed
      ) VALUES (
        u.id,
        wise_acc_id,
        'wise_tx_rent_20260901_' || u.id,
        '2026-09-01T09:00:00.000Z',
        'EVANS RENTAL MANAGEMENT',
        'EVANS RENTAL MANAGEMENT',
        -1367.56,
        'AUD',
        rent_cat_id,
        true,
        rent_fixed_id,
        false,
        true
      )
      ON CONFLICT (account_id, external_transaction_id) DO UPDATE SET
        amount = -1367.56,
        currency = 'AUD',
        category_id = EXCLUDED.category_id,
        is_fixed = true,
        fixed_expense_id = EXCLUDED.fixed_expense_id;
    END IF;
  END LOOP;
END $$;
