CREATE TABLE supplier_captures (
 id uuid PRIMARY KEY,
 capture_method text NOT NULL DEFAULT 'user_declared' CHECK(capture_method='user_declared'),
 supplier_id uuid NOT NULL UNIQUE REFERENCES sourcing_suppliers(id),
 candidate_id uuid NOT NULL REFERENCES candidates(id),
 spec_id uuid NOT NULL,
 input_version integer NOT NULL CHECK(input_version>0),
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 search_query text NOT NULL,
 company_url text NOT NULL,
 product_url text NOT NULL,
 observed_at timestamptz NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 body_ciphertext text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(spec_id,candidate_id) REFERENCES spec_revisions(id,candidate_id),
 UNIQUE(candidate_id,spec_id,input_version,settings_version,body_sha256)
);
CREATE TRIGGER supplier_captures_immutable BEFORE UPDATE OR DELETE ON supplier_captures
 FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
