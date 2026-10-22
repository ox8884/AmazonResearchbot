CREATE TABLE alibaba_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 candidate_id uuid NOT NULL REFERENCES candidates(id),
 spec_id uuid,
 input_version integer NOT NULL CHECK(input_version>0),
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 company_key text NOT NULL,
 company_name text NOT NULL,
 company_url text NOT NULL,
 product_url text NOT NULL,
 source_receipt_id uuid NOT NULL REFERENCES browser_task_results(id) DEFERRABLE INITIALLY DEFERRED,
 account_id text,
 provider_thread_id text,
 thread_url text,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','awaiting_reply','negotiating','attention','paused')),
 reason text,
 last_activity_at timestamptz,
 next_check_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_id,company_key),
 UNIQUE(id,candidate_id),
 FOREIGN KEY(spec_id,candidate_id) REFERENCES spec_revisions(id,candidate_id),
 CHECK((account_id IS NULL)=(provider_thread_id IS NULL))
);
CREATE UNIQUE INDEX alibaba_thread_owner ON alibaba_conversations(account_id,provider_thread_id)
 WHERE provider_thread_id IS NOT NULL;
CREATE TABLE alibaba_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id uuid NOT NULL REFERENCES alibaba_conversations(id),
 provider_message_id text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
 body_ciphertext text NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 sent_at timestamptz NOT NULL,
 receipt_id uuid NOT NULL REFERENCES browser_task_results(id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,provider_message_id),
 UNIQUE(id,conversation_id)
);
CREATE TABLE alibaba_actions (
 id uuid PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES alibaba_conversations(id),
 candidate_id uuid NOT NULL REFERENCES candidates(id),
 spec_id uuid,
 input_version integer NOT NULL CHECK(input_version>0),
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 kind text NOT NULL CHECK(kind IN ('initial','followup')),
 inbound_message_id uuid,
 body_ciphertext text NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatching','sent','outcome_unknown','blocked','cancelled')),
 reason text,
 dispatch_task_id uuid,
 sent_message_id uuid,
 started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,candidate_id) REFERENCES alibaba_conversations(id,candidate_id),
 FOREIGN KEY(spec_id,candidate_id) REFERENCES spec_revisions(id,candidate_id),
 FOREIGN KEY(inbound_message_id,conversation_id) REFERENCES alibaba_messages(id,conversation_id),
 FOREIGN KEY(sent_message_id,conversation_id) REFERENCES alibaba_messages(id,conversation_id),
 CHECK((kind='initial')=(inbound_message_id IS NULL)),
 CHECK((dispatch_task_id IS NULL)=(started_at IS NULL)),
 CHECK(state NOT IN ('dispatching','sent','outcome_unknown') OR started_at IS NOT NULL)
);
CREATE UNIQUE INDEX alibaba_initial_once ON alibaba_actions(conversation_id) WHERE kind='initial';
CREATE UNIQUE INDEX alibaba_inbound_once ON alibaba_actions(conversation_id,inbound_message_id) WHERE inbound_message_id IS NOT NULL;
CREATE TRIGGER alibaba_messages_immutable BEFORE UPDATE OR DELETE ON alibaba_messages
 FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
CREATE FUNCTION alibaba_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  (OLD.state='outcome_unknown' AND NEW.state IN ('sent','blocked')))
 THEN RAISE EXCEPTION 'Alibaba action transition rejected'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alibaba_action_immutable BEFORE UPDATE OR DELETE ON alibaba_actions
 FOR EACH ROW EXECUTE FUNCTION alibaba_action_guard();
ALTER TABLE browser_tasks ADD COLUMN conversation_id uuid REFERENCES alibaba_conversations(id);
ALTER TABLE browser_tasks ADD COLUMN action_id uuid REFERENCES alibaba_actions(id);
ALTER TABLE alibaba_actions ADD CONSTRAINT alibaba_dispatch_task FOREIGN KEY(dispatch_task_id) REFERENCES browser_tasks(id);
ALTER TABLE browser_tasks DROP CONSTRAINT browser_task_kind_scope;
ALTER TABLE browser_tasks ADD CONSTRAINT browser_task_kind_scope CHECK (
 (task_kind='saved_search_export' AND search_run_id IS NOT NULL AND conversation_id IS NULL AND action_id IS NULL)
 OR (task_kind IN ('amazon_package','amazon_search','product_database','keyword_scout','historical_data','category_trends','competitive_intelligence') AND search_run_id IS NULL AND spec_id IS NULL AND source_capture_id IS NULL AND conversation_id IS NULL AND action_id IS NULL)
 OR (task_kind='supplier_search' AND search_run_id IS NULL AND source_capture_id IS NULL AND conversation_id IS NULL AND action_id IS NULL)
 OR (task_kind='supplier_detail' AND search_run_id IS NULL AND spec_id IS NOT NULL AND source_capture_id IS NOT NULL AND conversation_id IS NULL AND action_id IS NULL)
 OR (task_kind='supplier_thread' AND search_run_id IS NULL AND source_capture_id IS NULL AND conversation_id IS NOT NULL AND action_id IS NULL)
 OR (task_kind='supplier_send' AND search_run_id IS NULL AND source_capture_id IS NULL AND conversation_id IS NOT NULL AND action_id IS NOT NULL)
);
DROP INDEX browser_task_current_scope;
CREATE UNIQUE INDEX browser_task_current_scope ON browser_tasks
 (device_id,task_kind,candidate_id,spec_id,input_version,settings_version,source_capture_id) NULLS NOT DISTINCT
 WHERE search_run_id IS NULL AND task_kind NOT IN ('supplier_thread','supplier_send') AND state IN ('queued','delivered','completed');
CREATE UNIQUE INDEX alibaba_active_poll ON browser_tasks(conversation_id)
 WHERE task_kind='supplier_thread' AND state IN ('queued','delivered');
CREATE UNIQUE INDEX alibaba_action_task ON browser_tasks(action_id)
 WHERE action_id IS NOT NULL AND state IN ('queued','delivered','completed');
CREATE OR REPLACE FUNCTION browser_task_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.device_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.envelope,NEW.task_hash,NEW.expires_at,NEW.created_at,NEW.source_capture_id,NEW.search_run_id,NEW.task_kind,NEW.conversation_id,NEW.action_id)
 IS DISTINCT FROM ROW(OLD.id,OLD.device_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.envelope,OLD.task_hash,OLD.expires_at,OLD.created_at,OLD.source_capture_id,OLD.search_run_id,OLD.task_kind,OLD.conversation_id,OLD.action_id)
 THEN RAISE EXCEPTION 'Browser task payload is immutable'; END IF;
 IF OLD.first_delivered_at IS NOT NULL AND NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
 THEN RAISE EXCEPTION 'Browser task first delivery is immutable'; END IF;
 IF OLD.state IN ('completed','cancelled') AND ROW(NEW.state,NEW.result_id) IS DISTINCT FROM ROW(OLD.state,OLD.result_id)
 THEN RAISE EXCEPTION 'Browser task terminal state is immutable'; END IF;
 IF NEW.state='cancelled' AND EXISTS(SELECT 1 FROM alibaba_actions a WHERE a.dispatch_task_id=OLD.id AND a.started_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Started Alibaba sends must retain late receipts'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION alibaba_conversation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Alibaba conversations cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM id FROM candidates WHERE id=NEW.candidate_id FOR UPDATE;
  IF (SELECT count(*) FROM alibaba_conversations WHERE candidate_id=NEW.candidate_id)>=3
   AND NOT EXISTS(SELECT 1 FROM alibaba_conversations WHERE candidate_id=NEW.candidate_id AND company_key=NEW.company_key)
  THEN RAISE EXCEPTION 'Alibaba company limit reached'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.company_key,NEW.company_name,NEW.company_url,NEW.product_url,NEW.source_receipt_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.company_key,OLD.company_name,OLD.company_url,OLD.product_url,OLD.source_receipt_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Alibaba conversation source is immutable'; END IF;
 IF OLD.provider_thread_id IS NOT NULL AND ROW(NEW.provider_thread_id,NEW.account_id) IS DISTINCT FROM ROW(OLD.provider_thread_id,OLD.account_id)
 THEN RAISE EXCEPTION 'Alibaba thread ownership is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alibaba_conversation_immutable BEFORE INSERT OR UPDATE OR DELETE ON alibaba_conversations
 FOR EACH ROW EXECUTE FUNCTION alibaba_conversation_guard();
ALTER TABLE alibaba_actions ADD CONSTRAINT alibaba_action_conversation_identity UNIQUE(id,conversation_id);
ALTER TABLE browser_tasks ADD CONSTRAINT alibaba_task_candidate FOREIGN KEY(conversation_id,candidate_id) REFERENCES alibaba_conversations(id,candidate_id);
ALTER TABLE browser_tasks ADD CONSTRAINT alibaba_task_action FOREIGN KEY(action_id,conversation_id) REFERENCES alibaba_actions(id,conversation_id);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_ops_api') THEN
  GRANT SELECT,INSERT,UPDATE ON alibaba_conversations,alibaba_messages,alibaba_actions TO forge_ops_api;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_ops_worker') THEN
  GRANT SELECT,INSERT,UPDATE ON alibaba_conversations,alibaba_messages,alibaba_actions TO forge_ops_worker;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_ops_scheduler') THEN
  GRANT SELECT ON alibaba_conversations TO forge_ops_scheduler;
 END IF;
END; $$;
