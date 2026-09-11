-- Restrict admin_users_view to admins only
DROP VIEW IF EXISTS public.admin_users_view;

CREATE VIEW public.admin_users_view
WITH (security_invoker = on, security_barrier = true) AS
SELECT id, email, created_at, last_sign_in_at, email_confirmed_at
FROM auth.users
WHERE public.has_role(auth.uid(), 'admin'::public.app_role);

REVOKE ALL ON public.admin_users_view FROM anon, authenticated, public;
GRANT SELECT ON public.admin_users_view TO authenticated;