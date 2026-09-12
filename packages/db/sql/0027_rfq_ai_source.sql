ALTER TABLE rfq_drafts ADD COLUMN ai_task_id uuid REFERENCES ai_business_tasks(id);
CREATE FUNCTION guard_rfq_ai_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.ai_task_id IS DISTINCT FROM OLD.ai_task_id THEN
  RAISE EXCEPTION 'RFQ AI provenance is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rfq_ai_source_immutable BEFORE UPDATE ON rfq_drafts FOR EACH ROW EXECUTE FUNCTION guard_rfq_ai_source();
