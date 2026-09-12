CREATE TABLE saved_search_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 saved_search_id uuid NOT NULL REFERENCES saved_searches(id),
 created_by text NOT NULL REFERENCES "user"(id),
 search_revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 mode text NOT NULL DEFAULT 'manual' CHECK(mode='manual'),
 filter_verification text NOT NULL DEFAULT 'unverified' CHECK(filter_verification='unverified'),
 state text NOT NULL DEFAULT 'awaiting_csv' CHECK(state IN ('awaiting_csv','imported')),
 import_id uuid REFERENCES imports(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK((state='awaiting_csv' AND import_id IS NULL AND completed_at IS NULL) OR (state='imported' AND import_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX saved_search_pending_run ON saved_search_runs(saved_search_id,created_by) WHERE state='awaiting_csv';
CREATE FUNCTION guard_saved_search_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.saved_search_id IS DISTINCT FROM OLD.saved_search_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.search_revision IS DISTINCT FROM OLD.search_revision OR (OLD.import_id IS NOT NULL AND NEW.import_id IS DISTINCT FROM OLD.import_id) THEN
  RAISE EXCEPTION 'Search run provenance is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER saved_search_run_immutable BEFORE UPDATE ON saved_search_runs FOR EACH ROW EXECUTE FUNCTION guard_saved_search_run();
