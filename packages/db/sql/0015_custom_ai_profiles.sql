CREATE TABLE custom_ai_profiles (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 base_url text NOT NULL,
 model text NOT NULL,
 daily_budget_usd numeric(12,2) NOT NULL CHECK(daily_budget_usd >= 0),
 api_key_ciphertext text,
 api_key_last4 text,
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 version integer NOT NULL CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
