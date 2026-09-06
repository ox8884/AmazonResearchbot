ALTER TABLE api_attempts
  ADD COLUMN http_status integer;

CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  marketplace text NOT NULL,
  category text,
  filters jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
