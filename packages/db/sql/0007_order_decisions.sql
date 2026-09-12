CREATE TABLE order_packets (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  quote_id uuid NOT NULL REFERENCES supplier_quotes(id),
  spec_id uuid NOT NULL REFERENCES spec_revisions(id),
  settings_version integer NOT NULL REFERENCES settings_versions(version),
  decision text NOT NULL CHECK (decision IN ('go','hold','reject')),
  note text NOT NULL CHECK (btrim(note) <> ''),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
  state text NOT NULL DEFAULT 'pending_approval' CHECK (state IN ('pending_approval','recorded','stale','cancelled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_packets_candidate_created ON order_packets(candidate_id,created_at);

CREATE TABLE launch_cash_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  order_packet_id uuid NOT NULL UNIQUE REFERENCES order_packets(id),
  approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
  raw_usd numeric NOT NULL CHECK (raw_usd > 0),
  reserved_usd numeric NOT NULL CHECK (reserved_usd > 0),
  state text NOT NULL CHECK (state IN ('active','released')),
  created_by text NOT NULL,
  released_at timestamptz,
  released_by text,
  release_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state='active' AND released_at IS NULL AND released_by IS NULL AND release_note IS NULL)
    OR (state='released' AND released_at IS NOT NULL AND released_by IS NOT NULL AND btrim(release_note) <> '')
  )
);

CREATE UNIQUE INDEX launch_cash_reservations_one_active_candidate
  ON launch_cash_reservations(candidate_id) WHERE state='active';

CREATE FUNCTION order_packet_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'order packets cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.candidate_id,NEW.quote_id,NEW.spec_id,NEW.settings_version,NEW.decision,NEW.note,NEW.payload,NEW.payload_hash,NEW.approval_id,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.quote_id,OLD.spec_id,OLD.settings_version,OLD.decision,OLD.note,OLD.payload,OLD.payload_hash,OLD.approval_id,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'order packet content is immutable'; END IF;
  IF OLD.state <> NEW.state AND NOT (
    (OLD.state='pending_approval' AND NEW.state IN ('recorded','stale','cancelled'))
    OR (OLD.state='recorded' AND NEW.state='cancelled')
  ) THEN RAISE EXCEPTION 'invalid order packet state transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_packet_content_guard
  BEFORE UPDATE OR DELETE ON order_packets
  FOR EACH ROW EXECUTE FUNCTION order_packet_content_guard();

CREATE FUNCTION launch_cash_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'launch cash reservations cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.candidate_id,NEW.order_packet_id,NEW.approval_id,NEW.raw_usd,NEW.reserved_usd,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.order_packet_id,OLD.approval_id,OLD.raw_usd,OLD.reserved_usd,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'launch cash reservation content is immutable'; END IF;
  IF OLD.state='active' AND NEW.state='released' AND NEW.released_at IS NOT NULL AND NEW.released_by IS NOT NULL AND btrim(NEW.release_note) <> '' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.state,NEW.released_at,NEW.released_by,NEW.release_note)
     IS DISTINCT FROM ROW(OLD.state,OLD.released_at,OLD.released_by,OLD.release_note)
  THEN RAISE EXCEPTION 'launch cash reservation can only be released once'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER launch_cash_reservation_guard
  BEFORE UPDATE OR DELETE ON launch_cash_reservations
  FOR EACH ROW EXECUTE FUNCTION launch_cash_reservation_guard();
