-- Invitation lookup by token, without a tenant context.
--
-- invitations has FORCE ROW LEVEL SECURITY, which also applies to the table owner, so the
-- SECURITY DEFINER function from core_crm could never see a row. Instead, a narrow SELECT policy
-- exposes exactly the row whose token hash the caller supplies in a transaction-local setting.
-- Knowing the hash requires knowing the token, so this reveals nothing to anyone else.

CREATE POLICY invitation_token_lookup ON "invitations" FOR SELECT
  USING (token_hash = nullif(current_setting('app.invitation_token_hash', true), ''));

CREATE OR REPLACE FUNCTION app_invitation_tenant(p_token_hash text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  result uuid;
BEGIN
  PERFORM set_config('app.invitation_token_hash', p_token_hash, true);
  SELECT tenant_id INTO result FROM invitations
  WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now();
  PERFORM set_config('app.invitation_token_hash', '', true);
  RETURN result;
END
$$;
