CREATE TABLE browser_signing_identity (
 singleton smallint PRIMARY KEY CHECK(singleton=1),
 public_key text NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER browser_signing_identity_immutable BEFORE UPDATE OR DELETE ON browser_signing_identity
 FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
ALTER TABLE bridge_devices ADD COLUMN reported_connected boolean;
ALTER TABLE bridge_devices ADD COLUMN reported_tasks text[] NOT NULL DEFAULT '{}';
ALTER TABLE bridge_devices ADD COLUMN reported_key_fingerprint text;
ALTER TABLE bridge_devices ADD COLUMN reported_at timestamptz;
