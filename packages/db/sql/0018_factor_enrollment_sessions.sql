DROP TRIGGER factor_disable_revokes_auth ON "user";
CREATE TRIGGER factor_state_revokes_auth AFTER UPDATE OF two_factor_enabled ON "user"
FOR EACH ROW WHEN (OLD.two_factor_enabled IS DISTINCT FROM NEW.two_factor_enabled)
EXECUTE FUNCTION invalidate_credential_sessions('two_factor_state_changed');
