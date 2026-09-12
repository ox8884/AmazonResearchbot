ALTER TABLE api_operations ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK (generation > 0);
ALTER TABLE api_operations DROP CONSTRAINT api_operations_fingerprint_key;
ALTER TABLE api_operations ADD CONSTRAINT api_operations_fingerprint_generation_key UNIQUE(fingerprint,generation);
