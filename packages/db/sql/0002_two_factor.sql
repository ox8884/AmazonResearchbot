ALTER TABLE two_factor
  ADD COLUMN verified boolean NOT NULL DEFAULT false,
  ADD COLUMN failed_verification_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz;
