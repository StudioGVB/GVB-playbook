REVOKE EXECUTE ON FUNCTION public.get_up_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_up_token(uuid) TO service_role;