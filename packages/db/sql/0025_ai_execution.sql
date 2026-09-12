CREATE TABLE ai_execution_operations (
  id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('normalize', 'niche_analysis', 'sourcing_analysis', 'rfq_draft')),
  mode text NOT NULL CHECK (mode IN ('activation-approved-only', 'test')),
  grant_approval_id uuid REFERENCES approvals(id),
  state text NOT NULL CHECK (state IN ('pending', 'dispatching', 'succeeded', 'failed_dispatched', 'failed_non_dispatch', 'outcome_unknown', 'budget_blocked', 'price_unknown', 'no_provider')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  ,CHECK (
    (mode = 'activation-approved-only' AND grant_approval_id IS NULL)
    OR (mode = 'test' AND grant_approval_id IS NOT NULL)
  )
);

CREATE TABLE ai_provider_day_costs (
  profile_id uuid NOT NULL REFERENCES custom_ai_profiles(id),
  day_utc date NOT NULL,
  reserved_usd numeric(18,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  consumed_usd numeric(18,6) NOT NULL DEFAULT 0 CHECK (consumed_usd >= 0),
  PRIMARY KEY (profile_id, day_utc)
);

CREATE TABLE ai_execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES ai_execution_operations(id),
  profile_id uuid NOT NULL REFERENCES custom_ai_profiles(id),
  role text NOT NULL CHECK (role IN ('normalize', 'niche_analysis', 'sourcing_analysis', 'rfq_draft')),
  profile_version integer NOT NULL CHECK (profile_version > 0),
  key_revision integer NOT NULL CHECK (key_revision > 0),
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^[a-f0-9]{64}$'),
  budget_day date NOT NULL,
  reserved_usd numeric(18,6) NOT NULL CHECK (reserved_usd > 0),
  state text NOT NULL CHECK (state IN ('authorized', 'dispatching', 'succeeded', 'failed_dispatched', 'failed_non_dispatch', 'outcome_unknown')),
  provider_status integer CHECK (provider_status BETWEEN 100 AND 599),
  usage_known boolean NOT NULL DEFAULT false,
  reported_input_tokens integer CHECK (reported_input_tokens IS NULL OR reported_input_tokens >= 0),
  reported_output_tokens integer CHECK (reported_output_tokens IS NULL OR reported_output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (operation_id, profile_id),
  CHECK (
    (usage_known = false AND reported_input_tokens IS NULL AND reported_output_tokens IS NULL)
    OR (usage_known = true AND reported_input_tokens IS NOT NULL AND reported_output_tokens IS NOT NULL)
  )
);

CREATE INDEX ai_execution_attempts_operation_state ON ai_execution_attempts(operation_id, state);
