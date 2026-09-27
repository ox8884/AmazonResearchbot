-- Jev shadow-mode log: one typed judgment per open item, recorded next to what the exact-match code decided.
-- Production: GRANT SELECT, INSERT ON jev_decisions TO forge_ops_worker;
CREATE TABLE jev_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('spec_match', 'differentiation', 'inbox_rfq')),
  subject_id uuid NOT NULL,
  baseline text NOT NULL,
  answers jsonb,
  error text,
  model text,
  latency_ms integer,
  input_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, subject_id),
  CHECK ((answers IS NULL) <> (error IS NULL))
);
