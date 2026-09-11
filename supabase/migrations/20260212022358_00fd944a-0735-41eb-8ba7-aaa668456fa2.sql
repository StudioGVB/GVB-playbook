-- Create a security-definer function to retrieve the Up token for syncing
-- This function executes with elevated privileges so it can read the vault
CREATE OR REPLACE FUNCTION public.get_up_token(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _token text;
BEGIN
  -- Only allow users to retrieve their own token
  IF auth.uid() != _user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user token';
  END IF;

  -- TODO: Retrieve from vault when available
  -- SELECT decrypted_secret INTO _token FROM vault.decrypted_secrets
  -- WHERE name = format('up_token_%s', _user_id);
  
  -- For now, return null (vault integration pending)
  RETURN NULL;
END;
$$;