CREATE TABLE composio_gmail_connections (
 user_id text PRIMARY KEY REFERENCES "user"(id),
 key_fingerprint text NOT NULL,
 session_ciphertext text NOT NULL,
 mcp_ciphertext text NOT NULL,
 account_id text,
 link_ciphertext text,
 link_expires_at timestamptz,
 status text NOT NULL CHECK(status IN ('pending','active','expired','unknown','mismatch')),
 email text,
 checked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
