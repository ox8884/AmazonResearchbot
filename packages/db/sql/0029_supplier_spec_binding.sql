ALTER TABLE spec_revisions ADD CONSTRAINT spec_revision_candidate_identity UNIQUE(id,candidate_id);
ALTER TABLE sourcing_suppliers ADD COLUMN spec_id uuid;
ALTER TABLE sourcing_suppliers ADD CONSTRAINT supplier_spec_candidate
 FOREIGN KEY(spec_id,candidate_id) REFERENCES spec_revisions(id,candidate_id);
