
-- Revoke broad EXECUTE on SECURITY DEFINER functions from PUBLIC and anon
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_up_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_up_token(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_transaction_categories(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_transaction_categories(jsonb) TO authenticated, service_role;

-- Trigger-only helpers should not be callable via the Data API at all
REVOKE ALL ON FUNCTION public.validate_goal_assigned_amount() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Explicit restrictive protection on user_roles to prevent privilege escalation.
-- Only admins may INSERT/UPDATE/DELETE their own or any role.
CREATE POLICY "Only admins can insert roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update roles"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete roles"
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
