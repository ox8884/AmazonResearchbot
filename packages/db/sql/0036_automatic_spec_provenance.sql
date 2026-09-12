ALTER TABLE ai_business_tasks ADD CONSTRAINT ai_business_task_candidate_identity UNIQUE(id,candidate_id);
ALTER TABLE spec_revisions ADD COLUMN ai_task_id uuid UNIQUE;
ALTER TABLE spec_revisions ADD CONSTRAINT spec_ai_source_candidate
 FOREIGN KEY(ai_task_id,candidate_id) REFERENCES ai_business_tasks(id,candidate_id);
ALTER TABLE spec_revisions ADD CONSTRAINT initial_automatic_spec_only CHECK(ai_task_id IS NULL OR revision=1);
