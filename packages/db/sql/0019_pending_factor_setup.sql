CREATE OR REPLACE FUNCTION invalidate_credential_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user text;
BEGIN
 IF TG_TABLE_NAME='user' THEN target_user:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target_user:=OLD.user_id;
 ELSE target_user:=NEW.user_id;
 END IF;
 IF TG_TABLE_NAME='two_factor' AND NOT EXISTS(SELECT 1 FROM "user" WHERE id=target_user AND two_factor_enabled) THEN
   RETURN NULL;
 END IF;
 DELETE FROM session WHERE user_id=target_user;
 DELETE FROM verification
 WHERE identifier IN (SELECT '2fa-attempts-' || identifier FROM verification WHERE value=target_user AND identifier LIKE '2fa-%')
 OR (value=target_user AND (identifier LIKE 'trust-device-%' OR identifier LIKE '2fa-%'));
 INSERT INTO audit_events(actor,action,target,meta) VALUES(target_user,'credential_sessions_invalidated',target_user,jsonb_build_object('reason',TG_ARGV[0]));
 RETURN NULL;
END;
$$;
