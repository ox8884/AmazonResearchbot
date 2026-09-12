CREATE TABLE bridge_pairings (
 id uuid PRIMARY KEY,
 owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 issuer_session_id text REFERENCES session(id) ON DELETE SET NULL,
 code_sha256 text NOT NULL UNIQUE CHECK(code_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 cancelled_at timestamptz,
 CHECK(expires_at <= created_at + interval '5 minutes')
);
CREATE TABLE bridge_devices (
 id uuid PRIMARY KEY,
 owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 pairing_id uuid NOT NULL UNIQUE REFERENCES bridge_pairings(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 credential_sha256 text NOT NULL UNIQUE CHECK(credential_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX bridge_devices_owner ON bridge_devices(owner_user_id,created_at);
