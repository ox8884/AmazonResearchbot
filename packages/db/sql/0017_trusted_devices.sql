ALTER TABLE verification ADD COLUMN user_agent text;
UPDATE verification SET identifier='trust-device-sha256:' || encode(sha256(convert_to(identifier,'UTF8')),'hex')
WHERE identifier LIKE 'trust-device-%' AND identifier NOT LIKE 'trust-device-sha256:%';

CREATE FUNCTION invalidate_credential_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user text;
BEGIN
 IF TG_TABLE_NAME='user' THEN target_user:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target_user:=OLD.user_id;
 ELSE target_user:=NEW.user_id;
 END IF;
 DELETE FROM session WHERE user_id=target_user;
 DELETE FROM verification
 WHERE identifier IN (SELECT '2fa-attempts-' || identifier FROM verification WHERE value=target_user AND identifier LIKE '2fa-%')
 OR (value=target_user AND (identifier LIKE 'trust-device-%' OR identifier LIKE '2fa-%'));
 INSERT INTO audit_events(actor,action,target,meta) VALUES(target_user,'credential_sessions_invalidated',target_user,jsonb_build_object('reason',TG_ARGV[0]));
 RETURN NULL;
END;
$$;
CREATE TRIGGER password_revokes_auth AFTER UPDATE OF password ON account
FOR EACH ROW WHEN (NEW.provider_id='credential' AND OLD.password IS DISTINCT FROM NEW.password)
EXECUTE FUNCTION invalidate_credential_sessions('password_changed');
CREATE TRIGGER factor_secret_revokes_auth AFTER UPDATE OF secret ON two_factor
FOR EACH ROW WHEN (OLD.secret IS DISTINCT FROM NEW.secret)
EXECUTE FUNCTION invalidate_credential_sessions('two_factor_changed');
CREATE TRIGGER factor_delete_revokes_auth AFTER DELETE ON two_factor
FOR EACH ROW EXECUTE FUNCTION invalidate_credential_sessions('two_factor_reset');
CREATE TRIGGER factor_disable_revokes_auth AFTER UPDATE OF two_factor_enabled ON "user"
FOR EACH ROW WHEN (OLD.two_factor_enabled AND NOT NEW.two_factor_enabled)
EXECUTE FUNCTION invalidate_credential_sessions('two_factor_disabled');
