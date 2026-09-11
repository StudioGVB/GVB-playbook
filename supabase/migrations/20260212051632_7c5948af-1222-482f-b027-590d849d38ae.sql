
-- Add fingerprint column
ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS transaction_fingerprint text;

-- Backfill with dupe handling (append sequence for same-day same-amount same-desc)
WITH numbered AS (
  SELECT id,
    encode(
      sha256(
        convert_to(
          user_id::text || '|' || account_id::text || '|' ||
          to_char(posted_at, 'YYYY-MM-DD') || '|' ||
          to_char(amount, 'FM999999999990.00') || '|' ||
          upper(regexp_replace(trim(description), '[^A-Za-z0-9 ]', '', 'g')),
          'UTF8'
        )
      ),
      'hex'
    ) AS base_fp,
    row_number() OVER (
      PARTITION BY user_id,
        encode(
          sha256(
            convert_to(
              user_id::text || '|' || account_id::text || '|' ||
              to_char(posted_at, 'YYYY-MM-DD') || '|' ||
              to_char(amount, 'FM999999999990.00') || '|' ||
              upper(regexp_replace(trim(description), '[^A-Za-z0-9 ]', '', 'g')),
              'UTF8'
            )
          ),
          'hex'
        )
      ORDER BY created_at
    ) AS rn
  FROM public.finance_transactions
  WHERE transaction_fingerprint IS NULL
)
UPDATE public.finance_transactions ft
SET transaction_fingerprint = CASE WHEN n.rn = 1 THEN n.base_fp ELSE n.base_fp || '_' || n.rn END
FROM numbered n
WHERE ft.id = n.id;

-- Create unique partial index
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_fingerprint
  ON public.finance_transactions (user_id, transaction_fingerprint)
  WHERE transaction_fingerprint IS NOT NULL;
