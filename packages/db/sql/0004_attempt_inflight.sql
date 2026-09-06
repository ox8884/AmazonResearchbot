CREATE UNIQUE INDEX api_attempts_one_inflight
  ON api_attempts (operation_id)
  WHERE status IN ('authorized', 'dispatching');
