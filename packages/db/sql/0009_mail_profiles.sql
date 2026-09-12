CREATE TABLE mail_profiles (
  id uuid PRIMARY KEY,
  singleton_key smallint NOT NULL DEFAULT 1 UNIQUE CHECK (singleton_key = 1),
  name text NOT NULL CHECK (btrim(name) <> ''),
  smtp_host text NOT NULL CHECK (btrim(smtp_host) <> ''),
  smtp_port integer NOT NULL CHECK (smtp_port IN (465,587)),
  imap_host text NOT NULL CHECK (btrim(imap_host) <> ''),
  imap_port integer NOT NULL CHECK (imap_port = 993),
  sender text NOT NULL CHECK (btrim(sender) <> ''),
  username text NOT NULL CHECK (btrim(username) <> ''),
  sent_mailbox text NOT NULL CHECK (btrim(sent_mailbox) <> ''),
  inbox_mailbox text NOT NULL CHECK (btrim(inbox_mailbox) <> ''),
  password_ciphertext text,
  password_last4 text,
  secret_version integer NOT NULL DEFAULT 0 CHECK (secret_version >= 0),
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('pending_approval','active','disabled')),
  activated_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (password_ciphertext IS NULL AND password_last4 IS NULL AND secret_version = 0)
    OR (password_ciphertext IS NOT NULL AND password_last4 IS NOT NULL AND secret_version > 0)
  )
);

CREATE TABLE mail_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES mail_profiles(id),
  version integer NOT NULL CHECK (version > 0),
  event text NOT NULL CHECK (event IN ('saved','activation_requested','activated','disabled')),
  safe_snapshot jsonb NOT NULL,
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^[a-f0-9]{64}$'),
  secret_version integer NOT NULL CHECK (secret_version >= 0),
  approval_id uuid REFERENCES approvals(id),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mail_profile_history_profile_created ON mail_profile_history(profile_id,created_at);

CREATE FUNCTION mail_profile_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mail profile history is append-only';
END;
$$;

CREATE TRIGGER mail_profile_history_immutable_guard
  BEFORE UPDATE OR DELETE ON mail_profile_history
  FOR EACH ROW EXECUTE FUNCTION mail_profile_history_immutable();
