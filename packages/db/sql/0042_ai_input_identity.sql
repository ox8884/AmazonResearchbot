ALTER TABLE ai_business_tasks ADD COLUMN input_hash bytea;
UPDATE ai_business_tasks SET input_hash=sha256(convert_to(input_payload::text,'UTF8'));
ALTER TABLE ai_business_tasks ALTER COLUMN input_hash SET NOT NULL;
CREATE FUNCTION set_ai_business_input_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.input_hash:=sha256(convert_to(NEW.input_payload::text,'UTF8'));
 RETURN NEW;
END $$;
CREATE TRIGGER ai_business_input_hash BEFORE INSERT ON ai_business_tasks
 FOR EACH ROW EXECUTE FUNCTION set_ai_business_input_hash();
ALTER TABLE ai_business_tasks DROP CONSTRAINT ai_business_tasks_candidate_id_input_version_settings_versi_key;
ALTER TABLE ai_business_tasks ADD CONSTRAINT ai_business_source_scope
 UNIQUE NULLS NOT DISTINCT(candidate_id,input_version,settings_version,role,spec_id,input_hash);
CREATE OR REPLACE FUNCTION guard_ai_business_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.spec_id IS DISTINCT FROM OLD.spec_id OR NEW.id IS DISTINCT FROM OLD.id
  OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id OR NEW.input_version IS DISTINCT FROM OLD.input_version
  OR NEW.settings_version IS DISTINCT FROM OLD.settings_version OR NEW.role IS DISTINCT FROM OLD.role
  OR NEW.input_payload IS DISTINCT FROM OLD.input_payload OR NEW.input_hash IS DISTINCT FROM OLD.input_hash THEN
  RAISE EXCEPTION 'AI business input is immutable';
 END IF;
 RETURN NEW;
END $$;
