ALTER TABLE browser_tasks ADD COLUMN task_kind text;
UPDATE browser_tasks SET task_kind=CASE
 WHEN search_run_id IS NOT NULL THEN 'saved_search_export'
 WHEN spec_id IS NULL THEN 'amazon_package'
 WHEN source_capture_id IS NOT NULL THEN 'supplier_detail'
 ELSE 'supplier_search' END;
ALTER TABLE browser_tasks ALTER COLUMN task_kind SET NOT NULL;
ALTER TABLE browser_tasks ALTER COLUMN task_kind SET DEFAULT 'supplier_search';
ALTER TABLE browser_tasks ADD CONSTRAINT browser_task_kind_scope CHECK (
 (task_kind='saved_search_export' AND search_run_id IS NOT NULL)
 OR (task_kind IN ('amazon_package','amazon_search') AND search_run_id IS NULL AND spec_id IS NULL AND source_capture_id IS NULL)
 OR (task_kind='supplier_search' AND search_run_id IS NULL AND spec_id IS NOT NULL AND source_capture_id IS NULL)
 OR (task_kind='supplier_detail' AND search_run_id IS NULL AND spec_id IS NOT NULL AND source_capture_id IS NOT NULL)
);
DROP INDEX browser_task_current_scope;
CREATE UNIQUE INDEX browser_task_current_scope ON browser_tasks
 (device_id,task_kind,candidate_id,spec_id,input_version,settings_version,source_capture_id) NULLS NOT DISTINCT
 WHERE search_run_id IS NULL AND state IN ('queued','delivered','completed');
CREATE OR REPLACE FUNCTION browser_task_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.device_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.envelope,NEW.task_hash,NEW.expires_at,NEW.created_at,NEW.source_capture_id,NEW.search_run_id,NEW.task_kind)
 IS DISTINCT FROM ROW(OLD.id,OLD.device_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.envelope,OLD.task_hash,OLD.expires_at,OLD.created_at,OLD.source_capture_id,OLD.search_run_id,OLD.task_kind)
 THEN RAISE EXCEPTION 'Browser task payload is immutable'; END IF;
 IF OLD.state IN ('completed','cancelled') AND ROW(NEW.state,NEW.result_id) IS DISTINCT FROM ROW(OLD.state,OLD.result_id)
 THEN RAISE EXCEPTION 'Browser task terminal state is immutable'; END IF;
 RETURN NEW;
END; $$;
