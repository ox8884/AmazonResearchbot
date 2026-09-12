CREATE TABLE daily_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 schedule text NOT NULL CHECK(schedule IN ('research','summary')),
 local_date date NOT NULL,
 timezone text NOT NULL,
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 generated_at timestamptz NOT NULL,
 result jsonb NOT NULL,
 UNIQUE(schedule,local_date)
);
CREATE TABLE daily_planner_items (
 run_id uuid NOT NULL REFERENCES daily_runs(id),
 candidate_id uuid NOT NULL REFERENCES candidates(id),
 input_version integer NOT NULL,
 stage text NOT NULL,
 ordinal integer NOT NULL,
 job_id uuid NOT NULL,
 PRIMARY KEY(run_id,candidate_id)
);
CREATE TABLE daily_summaries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL UNIQUE REFERENCES daily_runs(id),
 local_date date NOT NULL UNIQUE,
 timezone text NOT NULL,
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 generated_at timestamptz NOT NULL,
 payload jsonb NOT NULL
);
CREATE FUNCTION daily_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Daily records are append-only'; END;
$$;
CREATE TRIGGER daily_runs_immutable BEFORE UPDATE OR DELETE ON daily_runs FOR EACH ROW EXECUTE FUNCTION daily_record_immutable();
CREATE TRIGGER daily_items_immutable BEFORE UPDATE OR DELETE ON daily_planner_items FOR EACH ROW EXECUTE FUNCTION daily_record_immutable();
CREATE TRIGGER daily_summaries_immutable BEFORE UPDATE OR DELETE ON daily_summaries FOR EACH ROW EXECUTE FUNCTION daily_record_immutable();
