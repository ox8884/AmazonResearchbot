CREATE OR REPLACE FUNCTION alibaba_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Alibaba actions cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.conversation_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.kind,NEW.inbound_message_id,NEW.body_ciphertext,NEW.body_sha256,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.conversation_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.kind,OLD.inbound_message_id,OLD.body_ciphertext,OLD.body_sha256,OLD.created_at)
 THEN RAISE EXCEPTION 'Alibaba action content is immutable'; END IF;
 IF OLD.started_at IS NOT NULL AND ROW(NEW.started_at,NEW.dispatch_task_id) IS DISTINCT FROM ROW(OLD.started_at,OLD.dispatch_task_id)
 THEN RAISE EXCEPTION 'Alibaba dispatch identity is immutable'; END IF;
 IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
  (OLD.state='pending' AND NEW.state IN ('dispatching','blocked','cancelled')) OR
  (OLD.state='dispatching' AND NEW.state IN ('sent','outcome_unknown','blocked')) OR
  (OLD.state='outcome_unknown' AND NEW.state IN ('sent','blocked')) OR
  (OLD.state='blocked' AND NEW.state='pending' AND OLD.reason IS NOT DISTINCT FROM 'NEGOTIATION_CONTEXT_CHANGED'
   AND OLD.started_at IS NULL AND OLD.dispatch_task_id IS NULL AND OLD.sent_message_id IS NULL
   AND NEW.started_at IS NULL AND NEW.dispatch_task_id IS NULL AND NEW.sent_message_id IS NULL))
 THEN RAISE EXCEPTION 'Alibaba action transition rejected'; END IF;
 RETURN NEW;
END; $$;
DROP INDEX alibaba_action_task;
CREATE UNIQUE INDEX alibaba_action_task ON browser_tasks(action_id)
 WHERE action_id IS NOT NULL AND state IN ('queued','delivered');
