ALTER TABLE supplier_captures DROP CONSTRAINT supplier_captures_capture_method_check;
ALTER TABLE supplier_captures ADD CONSTRAINT supplier_captures_capture_method_check
 CHECK(capture_method IN ('user_declared','aside_search_result','aside_product_detail'));
ALTER TABLE supplier_captures ADD CONSTRAINT supplier_capture_source_identity
 UNIQUE(id,candidate_id,spec_id,input_version,settings_version);
ALTER TABLE browser_tasks ADD COLUMN source_capture_id uuid;
ALTER TABLE browser_tasks ADD CONSTRAINT browser_detail_source_identity
 FOREIGN KEY(source_capture_id,candidate_id,spec_id,input_version,settings_version)
 REFERENCES supplier_captures(id,candidate_id,spec_id,input_version,settings_version);
DROP INDEX browser_task_current_scope;
CREATE UNIQUE INDEX browser_task_current_scope ON browser_tasks
(device_id,candidate_id,spec_id,input_version,settings_version,source_capture_id) NULLS NOT DISTINCT
WHERE state IN ('queued','delivered','completed');
CREATE OR REPLACE FUNCTION browser_task_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.device_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.envelope,NEW.task_hash,NEW.expires_at,NEW.created_at,NEW.source_capture_id)
 IS DISTINCT FROM ROW(OLD.id,OLD.device_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.envelope,OLD.task_hash,OLD.expires_at,OLD.created_at,OLD.source_capture_id)
 THEN RAISE EXCEPTION 'Browser task payload is immutable'; END IF;
 IF OLD.state IN ('completed','cancelled') AND ROW(NEW.state,NEW.result_id) IS DISTINCT FROM ROW(OLD.state,OLD.result_id)
 THEN RAISE EXCEPTION 'Browser task terminal state is immutable'; END IF;
 RETURN NEW;
END; $$;
