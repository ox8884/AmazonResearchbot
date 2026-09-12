ALTER TABLE evidence ADD COLUMN input_version integer CHECK(input_version IS NULL OR input_version > 0);
ALTER TABLE evidence ADD COLUMN settings_version integer REFERENCES settings_versions(version);
CREATE INDEX evidence_api_versions ON evidence(candidate_id,input_version,settings_version,field)
  WHERE input_version IS NOT NULL;
