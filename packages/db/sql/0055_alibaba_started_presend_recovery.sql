CREATE FUNCTION alibaba_presend_incident(action_id uuid,conversation_id uuid,task_id uuid,receipt_id uuid,started_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT ROW(action_id,conversation_id,task_id,receipt_id,started_at) IN (
  ROW('3dde4cfc-154f-473d-9bf3-62b6e0b427e8'::uuid,'d3251458-1474-45d4-9537-1ab2b59c88a5'::uuid,'7f38b710-c7b3-4827-8729-fdd8a599aebb'::uuid,'683cfdb9-19a7-4703-bd52-4643aa639352'::uuid,'2026-09-28T17:41:31.876671Z'::timestamptz),
  ROW('42173b4d-8386-411e-b084-f719a1b21739'::uuid,'b49b978b-8e1f-4f9d-af0c-7943af393db9'::uuid,'0be50528-3f39-4b79-a178-bbaf3cd1b883'::uuid,'ddc796c3-1a0f-4239-85be-c9dab34fbb07'::uuid,'2026-09-28T17:43:13.466536Z'::timestamptz));
$$;

CREATE UNIQUE INDEX alibaba_presend_once ON audit_events(target) WHERE action='alibaba_started_presend_recovery';

CREATE FUNCTION alibaba_presend_evidence(event audit_events,action_row alibaba_actions) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT (event).actor='worker:operator' AND (event).target=(action_row).id::text
  AND (event).meta->>'incident'='alibaba-presend-20260928'
  AND length((event).meta->>'authorizationReference') BETWEEN 1 AND 240
  AND (event).meta->>'originalClientHash'='c0b74ca596aa7a347ceb00ecf4956d30e8105952f29d7751a6a6c64b9b21f9d9'
  AND (event).meta->>'originalArchiveHash'='6f5a3ed8f863a657f4784d9a8a6c0ee1b29b260416327a3d5acbdd0ebd758954'
  AND (event).meta->>'conversationId'=(action_row).conversation_id::text
  AND (event).meta->>'bodyHash'=(action_row).body_sha256
  AND alibaba_presend_incident((action_row).id,(action_row).conversation_id,((event).meta->>'originalTaskId')::uuid,((event).meta->>'originalReceiptId')::uuid,((event).meta->>'originalStartedAt')::timestamptz)
  AND EXISTS(SELECT 1 FROM browser_tasks original JOIN browser_task_results failure ON failure.id=original.result_id AND failure.task_id=original.id
   JOIN browser_task_results fresh ON fresh.id=((event).meta->>'readReceiptId')::uuid
   JOIN browser_tasks reading ON reading.id=fresh.task_id AND reading.result_id=fresh.id
   WHERE original.id=((event).meta->>'originalTaskId')::uuid AND failure.id=((event).meta->>'originalReceiptId')::uuid
    AND original.state='completed' AND original.task_kind='supplier_send' AND original.action_id=(action_row).id
    AND ROW(original.conversation_id,original.candidate_id,original.spec_id,original.input_version,original.settings_version)
     IS NOT DISTINCT FROM ROW((action_row).conversation_id,(action_row).candidate_id,(action_row).spec_id,(action_row).input_version,(action_row).settings_version)
    AND reading.state='completed' AND reading.task_kind='supplier_thread' AND reading.action_id IS NULL
    AND ROW(reading.device_id,reading.conversation_id,reading.candidate_id,reading.spec_id,reading.input_version,reading.settings_version)
     IS NOT DISTINCT FROM ROW(original.device_id,original.conversation_id,original.candidate_id,original.spec_id,original.input_version,original.settings_version)
    AND original.task_hash=(event).meta->>'originalTaskHash' AND failure.body_sha256=(event).meta->>'originalReceiptHash'
    AND reading.task_hash=(event).meta->>'readTaskHash' AND fresh.body_sha256=(event).meta->>'readReceiptHash'
    AND reading.created_at>failure.created_at AND fresh.created_at>failure.created_at
    AND fresh.created_at BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()
    AND ((event).meta->>'readObservedAt')::timestamptz BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp());
$$;

CREATE FUNCTION alibaba_presend_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a alibaba_actions;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.action='alibaba_started_presend_recovery' OR (TG_OP='UPDATE' AND NEW.action='alibaba_started_presend_recovery')
  THEN RAISE EXCEPTION 'Alibaba pre-send recovery audit is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END IF;
 IF NEW.action<>'alibaba_started_presend_recovery' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM alibaba_actions WHERE id=NEW.target::uuid FOR UPDATE;
 IF a.id IS NULL OR a.kind<>'initial' OR a.state<>'blocked' OR a.reason IS DISTINCT FROM 'SEND_NOT_CONFIRMED' OR a.sent_message_id IS NOT NULL
  OR a.started_at IS DISTINCT FROM (NEW.meta->>'originalStartedAt')::timestamptz OR a.dispatch_task_id IS DISTINCT FROM (NEW.meta->>'originalTaskId')::uuid
  OR alibaba_presend_evidence(NEW,a) IS NOT TRUE
  OR ((NEW.meta->>'disposition'='requeue' AND (NEW.meta->>'newTaskId')::uuid IS NOT NULL AND NEW.meta->>'messageId' IS NULL)
   OR (NEW.meta->>'disposition'='reconciled' AND NEW.meta->>'newTaskId' IS NULL AND (NEW.meta->>'messageId')::uuid IS NOT NULL)) IS NOT TRUE
 THEN RAISE EXCEPTION 'Alibaba pre-send recovery evidence rejected'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alibaba_presend_audit BEFORE INSERT OR UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION alibaba_presend_audit_guard();

CREATE OR REPLACE FUNCTION alibaba_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recovery boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Alibaba actions cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.conversation_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.kind,NEW.inbound_message_id,NEW.body_ciphertext,NEW.body_sha256,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.conversation_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.kind,OLD.inbound_message_id,OLD.body_ciphertext,OLD.body_sha256,OLD.created_at)
 THEN RAISE EXCEPTION 'Alibaba action content is immutable'; END IF;
 recovery:=OLD.kind='initial' AND OLD.state='blocked' AND OLD.reason='SEND_NOT_CONFIRMED' AND OLD.sent_message_id IS NULL
  AND EXISTS(SELECT 1 FROM audit_events e WHERE e.action='alibaba_started_presend_recovery' AND e.target=OLD.id::text AND e.xmin::text=pg_current_xact_id()::text
   AND OLD.started_at=(e.meta->>'originalStartedAt')::timestamptz AND OLD.dispatch_task_id=(e.meta->>'originalTaskId')::uuid
   AND alibaba_presend_incident(OLD.id,OLD.conversation_id,OLD.dispatch_task_id,(e.meta->>'originalReceiptId')::uuid,OLD.started_at)
   AND NEW.reason IS NULL AND ((e.meta->>'disposition'='requeue' AND NEW.state='pending' AND NEW.started_at IS NULL AND NEW.dispatch_task_id IS NULL AND NEW.sent_message_id IS NULL)
    OR (e.meta->>'disposition'='reconciled' AND NEW.state='sent' AND NEW.started_at=OLD.started_at AND NEW.dispatch_task_id=OLD.dispatch_task_id AND NEW.sent_message_id=(e.meta->>'messageId')::uuid)));
 IF OLD.started_at IS NOT NULL AND ROW(NEW.started_at,NEW.dispatch_task_id) IS DISTINCT FROM ROW(OLD.started_at,OLD.dispatch_task_id) AND recovery IS NOT TRUE
 THEN RAISE EXCEPTION 'Alibaba dispatch identity is immutable'; END IF;
 IF NEW.state IS DISTINCT FROM OLD.state AND recovery IS NOT TRUE AND NOT (
  (OLD.state='pending' AND NEW.state IN ('dispatching','blocked','cancelled')) OR
  (OLD.state='dispatching' AND NEW.state IN ('sent','outcome_unknown','blocked')) OR
  (OLD.state='outcome_unknown' AND NEW.state IN ('sent','blocked')) OR
  (OLD.state='blocked' AND NEW.state='pending' AND OLD.reason IS NOT DISTINCT FROM 'NEGOTIATION_CONTEXT_CHANGED'
   AND OLD.started_at IS NULL AND OLD.dispatch_task_id IS NULL AND OLD.sent_message_id IS NULL
   AND NEW.started_at IS NULL AND NEW.dispatch_task_id IS NULL AND NEW.sent_message_id IS NULL))
 THEN RAISE EXCEPTION 'Alibaba action transition rejected'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION alibaba_presend_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a alibaba_actions; c alibaba_conversations;
BEGIN
 SELECT * INTO a FROM alibaba_actions WHERE id=NEW.target::uuid;
 SELECT * INTO c FROM alibaba_conversations WHERE id=a.conversation_id;
 IF alibaba_presend_evidence(NEW,a) IS NOT TRUE OR a.reason IS NOT NULL OR c.reason IS NOT NULL THEN
  RAISE EXCEPTION 'Alibaba pre-send recovery must commit coupled evidence and transition'; END IF;
 IF NEW.meta->>'disposition'='requeue' THEN
  IF a.state<>'pending' OR a.started_at IS NOT NULL OR a.dispatch_task_id IS NOT NULL OR a.sent_message_id IS NOT NULL OR c.status<>'queued'
   OR NOT EXISTS(SELECT 1 FROM browser_tasks t JOIN browser_tasks original ON original.id=(NEW.meta->>'originalTaskId')::uuid
    WHERE t.id=(NEW.meta->>'newTaskId')::uuid AND t.id<>original.id AND t.task_kind='supplier_send' AND t.state='queued' AND t.action_id=a.id
     AND t.task_hash=NEW.meta->>'newTaskHash' AND t.task_hash=encode(sha256(convert_to(t.envelope->>'payload','UTF8')),'hex')
     AND convert_from(decode(translate(t.envelope->>'payload','-_','+/')||repeat('=',(4-length(t.envelope->>'payload')%4)%4),'base64'),'UTF8')::jsonb->'request'
      =convert_from(decode(translate(original.envelope->>'payload','-_','+/')||repeat('=',(4-length(original.envelope->>'payload')%4)%4),'base64'),'UTF8')::jsonb->'request'
     AND t.first_delivered_at IS NULL AND t.delivered_at IS NULL AND t.result_id IS NULL AND t.expires_at>clock_timestamp()
     AND ROW(t.device_id,t.conversation_id,t.candidate_id,t.spec_id,t.input_version,t.settings_version)
      IS NOT DISTINCT FROM ROW(original.device_id,a.conversation_id,a.candidate_id,a.spec_id,a.input_version,a.settings_version))
  THEN RAISE EXCEPTION 'Alibaba pre-send recovery requires one new unstarted task'; END IF;
 ELSE
  IF a.state<>'sent' OR a.started_at IS DISTINCT FROM (NEW.meta->>'originalStartedAt')::timestamptz OR a.dispatch_task_id IS DISTINCT FROM (NEW.meta->>'originalTaskId')::uuid OR c.status<>'awaiting_reply'
   OR NOT EXISTS(SELECT 1 FROM alibaba_messages m JOIN browser_task_results r ON r.id=m.receipt_id JOIN browser_tasks t ON t.id=r.task_id AND t.result_id=r.id AND t.state='completed' AND t.conversation_id=m.conversation_id
    WHERE m.id=a.sent_message_id AND m.id=(NEW.meta->>'messageId')::uuid AND m.conversation_id=a.conversation_id AND m.direction='outbound' AND m.body_sha256=a.body_sha256 AND m.sent_at>=a.started_at-interval '5 seconds')
   OR EXISTS(SELECT 1 FROM browser_tasks WHERE action_id=a.id AND id<>a.dispatch_task_id AND state IN ('queued','delivered'))
  THEN RAISE EXCEPTION 'Alibaba pre-send reconciliation requires exact outbound without a new send'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER alibaba_presend_commit AFTER INSERT ON audit_events DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.action='alibaba_started_presend_recovery') EXECUTE FUNCTION alibaba_presend_commit_guard();
