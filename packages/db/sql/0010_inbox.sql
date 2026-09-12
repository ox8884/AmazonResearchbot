CREATE TABLE inbox_mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES mail_profiles(id),
  mailbox_key text NOT NULL CHECK (mailbox_key ~ '^[a-f0-9]{64}$'),
  uid_validity text NOT NULL CHECK (btrim(uid_validity) <> ''),
  last_uid bigint NOT NULL CHECK (last_uid >= 0),
  last_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, mailbox_key, uid_validity)
);

CREATE INDEX inbox_mailboxes_current_cursor
  ON inbox_mailboxes(profile_id, mailbox_key, updated_at DESC, id DESC);

CREATE TABLE inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id uuid NOT NULL REFERENCES inbox_mailboxes(id),
  profile_id uuid NOT NULL REFERENCES mail_profiles(id),
  uid bigint NOT NULL CHECK (uid > 0),
  source_identity text NOT NULL,
  message_id text,
  in_reply_to_ids text[] NOT NULL,
  reference_ids text[] NOT NULL,
  from_addresses text[] NOT NULL,
  to_addresses text[] NOT NULL,
  subject text,
  received_at_source text,
  received_at timestamptz,
  raw_state text NOT NULL CHECK (raw_state IN ('captured', 'missing')),
  raw_hash text CHECK (raw_hash IS NULL OR raw_hash ~ '^[a-f0-9]{64}$'),
  raw_ciphertext text,
  body_state text NOT NULL CHECK (body_state IN ('text', 'unsupported', 'too_large', 'unreadable', 'missing')),
  body_ciphertext text,
  classification text NOT NULL CHECK (classification IN ('linked', 'unclassified', 'duplicate', 'conflict')),
  classification_reason text NOT NULL,
  rfq_id uuid REFERENCES rfq_drafts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_id, uid),
  CHECK (
    (raw_state = 'captured' AND raw_hash IS NOT NULL AND raw_ciphertext IS NOT NULL)
    OR (raw_state = 'missing' AND raw_hash IS NULL AND raw_ciphertext IS NULL)
  ),
  CHECK ((classification = 'linked') = (rfq_id IS NOT NULL))
);

CREATE INDEX inbox_messages_profile_message_id
  ON inbox_messages(profile_id, message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX inbox_messages_profile_raw_hash
  ON inbox_messages(profile_id, raw_hash)
  WHERE raw_hash IS NOT NULL;

CREATE TABLE inbox_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_message_id uuid NOT NULL REFERENCES inbox_messages(id),
  part text NOT NULL,
  filename text,
  media_type text NOT NULL,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  state text NOT NULL CHECK (state IN ('text', 'unsupported', 'too_large', 'unreadable')),
  bytes_ciphertext text,
  text_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inbox_message_id, part)
);

CREATE FUNCTION inbox_captures_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inbox captures are append-only';
END;
$$;

CREATE TRIGGER inbox_messages_immutable
  BEFORE UPDATE OR DELETE ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION inbox_captures_immutable();
CREATE TRIGGER inbox_attachments_immutable
  BEFORE UPDATE OR DELETE ON inbox_attachments
  FOR EACH ROW EXECUTE FUNCTION inbox_captures_immutable();
