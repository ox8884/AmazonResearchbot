ALTER TABLE api_validation_sources DROP CONSTRAINT api_validation_sources_endpoint_check;
ALTER TABLE api_validation_sources ADD CONSTRAINT api_validation_sources_endpoint_check
  CHECK (endpoint IN ('product_database_query','keywords_by_keyword_query','historical_search_volume','sales_estimates_query','share_of_voice'));
ALTER TABLE api_validation_sources DROP CONSTRAINT api_validation_sources_candidate_id_input_version_settings__key;
ALTER TABLE api_validation_sources ADD CONSTRAINT api_source_observation_key
  UNIQUE NULLS NOT DISTINCT (candidate_id,input_version,settings_version,endpoint,request_fingerprint,body_sha256,observed_at);
