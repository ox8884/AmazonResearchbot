ALTER TABLE browser_tasks ADD COLUMN search_run_id uuid REFERENCES saved_search_runs(id);
ALTER TABLE browser_tasks ALTER COLUMN candidate_id DROP NOT NULL;
ALTER TABLE browser_tasks ALTER COLUMN input_version DROP NOT NULL;
ALTER TABLE browser_tasks ALTER COLUMN settings_version DROP NOT NULL;
ALTER TABLE browser_tasks ADD CONSTRAINT browser_task_subject CHECK (
 (search_run_id IS NOT NULL AND candidate_id IS NULL AND spec_id IS NULL AND input_version IS NULL AND settings_version IS NULL AND source_capture_id IS NULL)
 OR (search_run_id IS NULL AND candidate_id IS NOT NULL AND input_version IS NOT NULL AND settings_version IS NOT NULL)
);
DROP INDEX browser_task_current_scope;
CREATE UNIQUE INDEX browser_task_current_scope ON browser_tasks
 (device_id,candidate_id,spec_id,input_version,settings_version,source_capture_id) NULLS NOT DISTINCT
 WHERE search_run_id IS NULL AND state IN ('queued','delivered','completed');
CREATE UNIQUE INDEX browser_search_run_task ON browser_tasks(search_run_id)
 WHERE search_run_id IS NOT NULL AND state IN ('queued','delivered','completed');
ALTER TABLE saved_search_runs DROP CONSTRAINT saved_search_runs_mode_check;
ALTER TABLE saved_search_runs ADD CONSTRAINT saved_search_runs_mode_check CHECK(mode IN ('manual','browser'));
ALTER TABLE saved_search_runs DROP CONSTRAINT saved_search_runs_filter_verification_check;
ALTER TABLE saved_search_runs ADD CONSTRAINT saved_search_runs_filter_verification_check
 CHECK(filter_verification='unverified' OR (filter_verification='applied' AND mode='browser' AND state='imported'));
CREATE OR REPLACE FUNCTION browser_task_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.device_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.envelope,NEW.task_hash,NEW.expires_at,NEW.created_at,NEW.source_capture_id,NEW.search_run_id)
 IS DISTINCT FROM ROW(OLD.id,OLD.device_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.envelope,OLD.task_hash,OLD.expires_at,OLD.created_at,OLD.source_capture_id,OLD.search_run_id)
 THEN RAISE EXCEPTION 'Browser task payload is immutable'; END IF;
 IF OLD.state IN ('completed','cancelled') AND ROW(NEW.state,NEW.result_id) IS DISTINCT FROM ROW(OLD.state,OLD.result_id)
 THEN RAISE EXCEPTION 'Browser task terminal state is immutable'; END IF;
 RETURN NEW;
END; $$;
