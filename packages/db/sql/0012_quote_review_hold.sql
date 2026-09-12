ALTER TABLE candidates ADD COLUMN quote_count_at_hold integer CHECK (quote_count_at_hold >= 0);
UPDATE candidates c SET quote_count_at_hold=(SELECT count(*)::integer FROM supplier_quotes q WHERE q.candidate_id=c.id)
WHERE c.stage='economics_review' AND c.blocked_reason='evidence';
