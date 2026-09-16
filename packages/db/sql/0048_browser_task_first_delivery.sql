ALTER TABLE browser_tasks ADD COLUMN first_delivered_at timestamptz;

UPDATE browser_tasks
SET first_delivered_at=delivered_at
WHERE delivered_at IS NOT NULL;

ALTER TABLE browser_tasks ADD CONSTRAINT browser_task_first_delivery
 CHECK(delivered_at IS NULL OR first_delivered_at IS NOT NULL);

CREATE OR REPLACE FUNCTION browser_task_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.device_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.envelope,NEW.task_hash,NEW.expires_at,NEW.created_at,NEW.source_capture_id,NEW.search_run_id,NEW.task_kind)
 IS DISTINCT FROM ROW(OLD.id,OLD.device_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.envelope,OLD.task_hash,OLD.expires_at,OLD.created_at,OLD.source_capture_id,OLD.search_run_id,OLD.task_kind)
 THEN RAISE EXCEPTION 'Browser task payload is immutable'; END IF;
 IF OLD.first_delivered_at IS NOT NULL AND NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
 THEN RAISE EXCEPTION 'Browser task first delivery is immutable'; END IF;
 IF OLD.state IN ('completed','cancelled') AND ROW(NEW.state,NEW.result_id) IS DISTINCT FROM ROW(OLD.state,OLD.result_id)
 THEN RAISE EXCEPTION 'Browser task terminal state is immutable'; END IF;
 RETURN NEW;
END; $$;
