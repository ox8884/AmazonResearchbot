CREATE TABLE IF NOT EXISTS api_validation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  input_version integer NOT NULL,
  settings_version integer NOT NULL REFERENCES settings_versions(version),
  endpoint text NOT NULL CHECK (endpoint = 'product_database_query'),
  request_fingerprint text NOT NULL,
  observed_at timestamptz,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  raw_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, input_version, settings_version, request_fingerprint, body_sha256)
);

CREATE OR REPLACE FUNCTION api_validation_sources_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'api validation sources are append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'api_validation_sources_immutable_guard'
  ) THEN
    CREATE TRIGGER api_validation_sources_immutable_guard
      BEFORE UPDATE OR DELETE ON api_validation_sources
      FOR EACH ROW EXECUTE FUNCTION api_validation_sources_immutable();
  END IF;
END;
$$;
