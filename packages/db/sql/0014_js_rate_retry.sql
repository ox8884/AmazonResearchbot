CREATE TABLE api_rate_windows (
  account_scope text NOT NULL CHECK (length(account_scope) BETWEEN 1 AND 256),
  window_kind text NOT NULL CHECK (window_kind IN ('second', 'minute')),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (account_scope, window_kind, window_started_at)
);

CREATE TABLE api_retry_schedules (
  operation_id uuid PRIMARY KEY REFERENCES api_operations(id),
  retry_count integer NOT NULL CHECK (retry_count BETWEEN 1 AND 2),
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_retry_schedules_due ON api_retry_schedules(next_attempt_at);
