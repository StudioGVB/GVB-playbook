
-- Convert apply_transaction_categories to SECURITY INVOKER (it self-filters by auth.uid())
CREATE OR REPLACE FUNCTION public.apply_transaction_categories(updates jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE finance_transactions ft
  SET category_id = u.category_id::uuid
  FROM jsonb_to_recordset(updates) AS u(id uuid, category_id text)
  WHERE ft.id = u.id
    AND ft.user_id = auth.uid();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

-- Lock down get_up_token: only the owning user session should call it. Revoke from anon.
REVOKE EXECUTE ON FUNCTION public.get_up_token(uuid) FROM PUBLIC, anon;

-- has_role must remain SECURITY DEFINER (used in RLS policies), but restrict to authenticated only.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
