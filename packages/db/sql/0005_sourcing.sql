CREATE TABLE spec_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  revision integer NOT NULL CHECK (revision > 0),
  material text NOT NULL,
  dimensions text NOT NULL,
  packaging text NOT NULL,
  requirements text NOT NULL,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, revision)
);

CREATE TABLE supplier_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  spec_id uuid NOT NULL REFERENCES spec_revisions(id),
  supplier_name text NOT NULL,
  supplier_source text NOT NULL,
  source_text text NOT NULL,
  received_at timestamptz NOT NULL,
  valid_until date,
  incoterm text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  moq integer NOT NULL CHECK (moq > 0 AND moq <= quantity),
  risks_confirmed boolean NOT NULL,
  risk_source text NOT NULL,
  cost_evidence jsonb NOT NULL,
  saved_settings_version integer NOT NULL REFERENCES settings_versions(version),
  saved_assessment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supplier_quotes_candidate_created_at ON supplier_quotes (candidate_id, created_at);

CREATE FUNCTION sourcing_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sourcing records are immutable';
END;
$$;

CREATE TRIGGER spec_revisions_immutable
  BEFORE UPDATE OR DELETE ON spec_revisions
  FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();

CREATE TRIGGER supplier_quotes_immutable
  BEFORE UPDATE OR DELETE ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
