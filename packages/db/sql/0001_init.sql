-- Applied by packages/db migrate(). schema_migrations is created by the runner.

CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  two_factor_enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE two_factor (
  id text PRIMARY KEY,
  secret text NOT NULL,
  backup_codes text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  ip text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_lookup ON login_attempts (email_normalized, ip, created_at);

CREATE TABLE deployment_identity (
  environment text PRIMARY KEY,
  worker_identity text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings_versions (
  version integer PRIMARY KEY,
  effective_at timestamptz NOT NULL,
  approved_by text NOT NULL,
  snapshot jsonb NOT NULL
);

CREATE TABLE settings_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_by text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  source_type text NOT NULL,
  schema_version text NOT NULL,
  marketplace text NOT NULL,
  blob_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sha256, marketplace)
);

CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES imports(id),
  row_number integer NOT NULL,
  raw_json jsonb NOT NULL,
  keyword_raw text NOT NULL,
  normalized_keyword text NOT NULL,
  error text,
  UNIQUE (import_id, row_number)
);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,
  normalized_keyword text NOT NULL,
  keyword_display text NOT NULL,
  stage text NOT NULL,
  blocked_reason text,
  input_version integer NOT NULL DEFAULT 1,
  last_progress_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marketplace, normalized_keyword)
);

CREATE TABLE candidate_import_rows (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  import_row_id uuid NOT NULL REFERENCES import_rows(id),
  PRIMARY KEY (candidate_id, import_row_id)
);

CREATE TABLE candidate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  stage text NOT NULL,
  input_version integer NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, stage, input_version)
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  field text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('measured', 'estimate', 'quote', 'unknown')),
  value_numeric numeric,
  value_text text,
  source_id text,
  observed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'unknown' AND value_numeric IS NULL)
    OR (kind <> 'unknown' AND (value_numeric IS NOT NULL OR value_text IS NOT NULL))
  ),
  CHECK (
    kind = 'unknown'
    OR (source_id IS NOT NULL AND observed_at IS NOT NULL)
  )
);

CREATE TABLE evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  settings_version integer NOT NULL REFERENCES settings_versions(version),
  kind text NOT NULL,
  outcome text NOT NULL,
  payload jsonb NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'supplier_contact', 'order_decision', 'budget_or_criteria_change', 'provider_activation'
  )),
  candidate_id uuid REFERENCES candidates(id),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text
);

CREATE TABLE budget_days (
  day_utc date PRIMARY KEY,
  reserved integer NOT NULL DEFAULT 0,
  consumed integer NOT NULL DEFAULT 0,
  wire_limit integer NOT NULL,
  CHECK (reserved >= 0 AND consumed >= 0)
);

CREATE TABLE api_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  provider text NOT NULL,
  endpoint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES api_operations(id),
  budget_day date NOT NULL REFERENCES budget_days(day_utc),
  status text NOT NULL CHECK (status IN ('authorized', 'dispatching', 'succeeded', 'http_failed', 'outcome_unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE api_cache (
  fingerprint text PRIMARY KEY,
  generation integer NOT NULL,
  body jsonb NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  ttl_hours integer NOT NULL
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  approval_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO deployment_identity (environment, worker_identity)
VALUES ('development', 'local-dev-worker');
