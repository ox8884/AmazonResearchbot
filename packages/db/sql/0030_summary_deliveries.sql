CREATE TABLE summary_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 summary_id uuid NOT NULL UNIQUE REFERENCES daily_summaries(id),
 settings_version integer NOT NULL REFERENCES settings_versions(version),
 recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, payload_hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatching','sent','unknown','blocked','cancelled')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 retry_at timestamptz NOT NULL DEFAULT now(), receipt text, reason text
);
CREATE FUNCTION summary_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Summary deliveries cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.summary_id,NEW.settings_version,NEW.recipient,NEW.subject,NEW.body,NEW.payload_hash,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.summary_id,OLD.settings_version,OLD.recipient,OLD.subject,OLD.body,OLD.payload_hash,OLD.created_at)
 THEN RAISE EXCEPTION 'Summary delivery content is immutable'; END IF;
 IF (OLD.state IN ('sent','cancelled') AND NEW.state<>OLD.state)
 OR (OLD.state='unknown' AND NEW.state NOT IN ('unknown','sent'))
 THEN RAISE EXCEPTION 'Terminal summary delivery cannot be retried'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER summary_delivery_immutable BEFORE UPDATE OR DELETE ON summary_deliveries FOR EACH ROW EXECUTE FUNCTION summary_delivery_guard();
