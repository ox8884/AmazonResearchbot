ALTER TABLE supplier_captures DROP CONSTRAINT supplier_captures_capture_method_check;
ALTER TABLE supplier_captures ADD CONSTRAINT supplier_captures_capture_method_check
 CHECK(capture_method IN ('user_declared','aside_search_result'));
ALTER TABLE supplier_captures ADD COLUMN source_page_url text;

CREATE TABLE browser_tasks (
 id uuid PRIMARY KEY,
 device_id uuid NOT NULL REFERENCES bridge_devices(id),
 candidate_id uuid NOT NULL REFERENCES candidates(id),
 spec_id uuid NOT NULL,
 input_version integer NOT NULL CHECK(input_version>0),
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 envelope jsonb NOT NULL,
 task_hash text NOT NULL CHECK(task_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','delivered','completed','cancelled')),
 expires_at timestamptz NOT NULL,
 delivered_at timestamptz,
 result_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(spec_id,candidate_id) REFERENCES spec_revisions(id,candidate_id),
 CHECK((state='completed')=(result_id IS NOT NULL)),
 CHECK(state NOT IN ('delivered','completed') OR delivered_at IS NOT NULL)
);
CREATE UNIQUE INDEX browser_task_current_scope ON browser_tasks
(device_id,candidate_id,spec_id,input_version,settings_version)
WHERE state IN ('queued','delivered','completed');
CREATE TABLE browser_task_results (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL UNIQUE REFERENCES browser_tasks(id),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 body_ciphertext text NOT NULL,
 capture_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,task_id)
);
ALTER TABLE browser_tasks ADD CONSTRAINT browser_task_result_identity
 FOREIGN KEY(result_id,id) REFERENCES browser_task_results(id,task_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER browser_task_results_immutable BEFORE UPDATE OR DELETE ON browser_task_results
 FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
CREATE FUNCTION browser_task_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.device_id,NEW.candidate_id,NEW.spec_id,NEW.input_version,NEW.settings_version,NEW.envelope,NEW.task_hash,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.device_id,OLD.candidate_id,OLD.spec_id,OLD.input_version,OLD.settings_version,OLD.envelope,OLD.task_hash,OLD.expires_at,OLD.created_at)
 THEN RAISE EXCEPTION 'Browser task payload is immutable'; END IF;
 IF OLD.state IN ('completed','cancelled') AND ROW(NEW.state,NEW.result_id) IS DISTINCT FROM ROW(OLD.state,OLD.result_id)
 THEN RAISE EXCEPTION 'Browser task terminal state is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER browser_task_immutable BEFORE UPDATE OR DELETE ON browser_tasks
 FOR EACH ROW EXECUTE FUNCTION browser_task_content_guard();
