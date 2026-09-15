ALTER TABLE bridge_devices ADD COLUMN hidden_at timestamptz;

CREATE INDEX bridge_devices_visible_owner
  ON bridge_devices(owner_user_id, created_at)
  WHERE hidden_at IS NULL;
