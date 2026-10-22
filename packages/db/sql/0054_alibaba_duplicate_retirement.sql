CREATE FUNCTION alibaba_conversation_retired(conversation alibaba_conversations) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT (conversation).status IS NOT DISTINCT FROM 'paused'
  AND (conversation).reason IS NOT DISTINCT FROM 'THREAD_OWNERSHIP_CONFLICT'
  AND (conversation).account_id IS NULL AND (conversation).provider_thread_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM alibaba_actions WHERE conversation_id=(conversation).id)
  AND NOT EXISTS(SELECT 1 FROM alibaba_messages WHERE conversation_id=(conversation).id);
$$;

CREATE OR REPLACE FUNCTION alibaba_conversation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Alibaba conversations cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtext('forge.settings'));
  PERFORM id FROM candidates WHERE id=NEW.candidate_id FOR UPDATE;
  IF NEW.status='paused' AND NEW.reason='THREAD_OWNERSHIP_CONFLICT' AND NEW.account_id IS NULL AND NEW.provider_thread_id IS NULL
  THEN RAISE EXCEPTION 'Alibaba duplicate retirement requires an existing attention row'; END IF;
  IF EXISTS(SELECT 1 FROM alibaba_conversations WHERE company_key=NEW.company_key AND candidate_id<>NEW.candidate_id)
   AND NOT EXISTS(SELECT 1 FROM alibaba_conversations WHERE candidate_id=NEW.candidate_id AND company_key=NEW.company_key)
  THEN RAISE EXCEPTION 'Alibaba company already used by another candidate'; END IF;
  IF (SELECT count(*) FROM alibaba_conversations c WHERE candidate_id=NEW.candidate_id AND NOT alibaba_conversation_retired(c))>=3
   AND NOT EXISTS(SELECT 1 FROM alibaba_conversations WHERE candidate_id=NEW.candidate_id AND company_key=NEW.company_key)
  THEN RAISE EXCEPTION 'Alibaba company limit reached'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.company_key,NEW.company_name,NEW.company_url,NEW.product_url,NEW.source_receipt_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.company_key,OLD.company_name,OLD.company_url,OLD.product_url,OLD.source_receipt_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Alibaba conversation source is immutable'; END IF;
 IF alibaba_conversation_retired(OLD) THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Retired Alibaba conversation is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='paused' AND NEW.reason='THREAD_OWNERSHIP_CONFLICT' AND NEW.account_id IS NULL AND NEW.provider_thread_id IS NULL THEN
  IF OLD.status<>'attention' OR OLD.reason IS DISTINCT FROM 'THREAD_OWNERSHIP_CONFLICT'
   OR OLD.account_id IS NOT NULL OR OLD.provider_thread_id IS NOT NULL
   OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
   OR EXISTS(SELECT 1 FROM alibaba_actions WHERE conversation_id=OLD.id)
   OR EXISTS(SELECT 1 FROM alibaba_messages WHERE conversation_id=OLD.id)
  THEN RAISE EXCEPTION 'Alibaba duplicate retirement rejected'; END IF;
 END IF;
 IF OLD.provider_thread_id IS NOT NULL AND ROW(NEW.provider_thread_id,NEW.account_id) IS DISTINCT FROM ROW(OLD.provider_thread_id,OLD.account_id)
 THEN RAISE EXCEPTION 'Alibaba thread ownership is immutable'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION alibaba_retired_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent alibaba_conversations; candidate uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('forge.settings'));
 SELECT candidate_id INTO candidate FROM alibaba_conversations WHERE id=NEW.conversation_id;
 PERFORM id FROM candidates WHERE id=candidate FOR UPDATE;
 SELECT * INTO parent FROM alibaba_conversations WHERE id=NEW.conversation_id FOR UPDATE;
 IF alibaba_conversation_retired(parent) THEN RAISE EXCEPTION 'Retired Alibaba conversation cannot receive actions, messages or tasks'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alibaba_retired_action BEFORE INSERT ON alibaba_actions
 FOR EACH ROW EXECUTE FUNCTION alibaba_retired_child_guard();
CREATE TRIGGER alibaba_retired_message BEFORE INSERT ON alibaba_messages
 FOR EACH ROW EXECUTE FUNCTION alibaba_retired_child_guard();
CREATE TRIGGER alibaba_retired_task BEFORE INSERT ON browser_tasks
 FOR EACH ROW WHEN (NEW.conversation_id IS NOT NULL) EXECUTE FUNCTION alibaba_retired_child_guard();
