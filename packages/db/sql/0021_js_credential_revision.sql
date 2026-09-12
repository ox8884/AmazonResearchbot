ALTER TABLE api_operations ADD COLUMN credential_revision text
  CHECK (credential_revision IS NULL OR credential_revision ~ '^[a-f0-9]{64}$');
