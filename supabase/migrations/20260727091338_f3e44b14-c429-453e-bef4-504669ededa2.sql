
-- 1. apply_transaction_categories: switch to INVOKER (self-scoped by auth.uid())
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

REVOKE ALL ON FUNCTION public.apply_transaction_categories(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_transaction_categories(jsonb) TO authenticated, service_role;

-- 2. get_up_token: unused stub, lock it down (service_role only)
REVOKE ALL ON FUNCTION public.get_up_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_up_token(uuid) TO service_role;

-- 3. has_role: keep DEFINER (required to bypass RLS on user_roles) but restrict callers
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- 4. validate_goal_assigned_amount is a trigger function; lock direct execution
REVOKE ALL ON FUNCTION public.validate_goal_assigned_amount() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_goal_assigned_amount() TO service_role;

-- 5. update_updated_at_column is a trigger function; lock direct execution
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
