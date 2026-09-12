ALTER TABLE custom_ai_profiles
  ADD COLUMN protocol text NOT NULL DEFAULT 'openai_chat_completions' CHECK (protocol = 'openai_chat_completions'),
  ADD COLUMN roles text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (
    cardinality(roles) <= 4
    AND roles <@ ARRAY['normalize', 'niche_analysis', 'sourcing_analysis', 'rfq_draft']::text[]
  ),
  ADD COLUMN priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  ADD COLUMN input_usd_per_million numeric(12,6) CHECK (input_usd_per_million IS NULL OR input_usd_per_million >= 0),
  ADD COLUMN output_usd_per_million numeric(12,6) CHECK (output_usd_per_million IS NULL OR output_usd_per_million >= 0),
  ADD COLUMN max_input_tokens integer NOT NULL DEFAULT 1024 CHECK (max_input_tokens BETWEEN 1 AND 131072),
  ADD COLUMN max_output_tokens integer NOT NULL DEFAULT 256 CHECK (max_output_tokens BETWEEN 1 AND 16384),
  ADD COLUMN retention_policy_url text,
  ADD COLUMN key_revision integer NOT NULL DEFAULT 0 CHECK (key_revision >= 0);

UPDATE custom_ai_profiles
SET key_revision = 1
WHERE api_key_ciphertext IS NOT NULL AND key_revision = 0;

ALTER TABLE custom_ai_profiles DROP CONSTRAINT IF EXISTS custom_ai_profiles_status_check;
ALTER TABLE custom_ai_profiles
  ADD CONSTRAINT custom_ai_profiles_status_check
  CHECK (status IN ('draft', 'pending_approval', 'active', 'disabled'));
