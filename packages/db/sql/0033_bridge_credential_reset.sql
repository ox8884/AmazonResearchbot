CREATE FUNCTION invalidate_bridge_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE bridge_devices SET revoked_at=now()
 WHERE owner_user_id=NEW.actor AND revoked_at IS NULL;
 UPDATE bridge_pairings SET cancelled_at=now()
 WHERE owner_user_id=NEW.actor AND consumed_at IS NULL AND cancelled_at IS NULL;
 RETURN NULL;
END;
$$;
CREATE TRIGGER credential_reset_revokes_bridge AFTER INSERT ON audit_events
FOR EACH ROW WHEN (NEW.action='credential_sessions_invalidated')
EXECUTE FUNCTION invalidate_bridge_credentials();
