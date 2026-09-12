ALTER TABLE ai_execution_operations ADD COLUMN result_payload jsonb;
CREATE TABLE ai_business_tasks (
 id uuid PRIMARY KEY REFERENCES ai_execution_operations(id),
 candidate_id uuid NOT NULL REFERENCES candidates(id),
 input_version integer NOT NULL CHECK(input_version>0),
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 spec_id uuid REFERENCES spec_revisions(id),
 role text NOT NULL CHECK(role IN ('normalize','niche_analysis','sourcing_analysis','rfq_draft')),
 input_payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','succeeded','stale','blocked','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT(candidate_id,input_version,settings_version,role,spec_id)
);
CREATE FUNCTION guard_ai_business_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.spec_id IS DISTINCT FROM OLD.spec_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id OR NEW.input_version IS DISTINCT FROM OLD.input_version OR NEW.settings_version IS DISTINCT FROM OLD.settings_version OR NEW.role IS DISTINCT FROM OLD.role OR NEW.input_payload IS DISTINCT FROM OLD.input_payload THEN
  RAISE EXCEPTION 'AI business input is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_business_input_immutable BEFORE UPDATE ON ai_business_tasks FOR EACH ROW EXECUTE FUNCTION guard_ai_business_input();
