CREATE TABLE sourcing_suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES candidates(id),
 name text NOT NULL, email text, source text NOT NULL, observed_at timestamptz NOT NULL,
 match_status text NOT NULL CHECK(match_status IN ('matches','mismatch','unknown')), match_notes text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER sourcing_suppliers_immutable BEFORE UPDATE OR DELETE ON sourcing_suppliers FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
CREATE TABLE rfq_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES candidates(id),
 supplier_id uuid NOT NULL REFERENCES sourcing_suppliers(id), spec_id uuid NOT NULL REFERENCES spec_revisions(id),
 quantity integer NOT NULL CHECK(quantity>0), recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','pending_approval','approved','sending','awaiting_quote','outcome_unknown','rejected','stale')),
 approval_id uuid UNIQUE REFERENCES approvals(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION rfq_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RFQ records cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.candidate_id,NEW.supplier_id,NEW.spec_id,NEW.quantity,NEW.recipient,NEW.subject,NEW.body,NEW.revision,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.supplier_id,OLD.spec_id,OLD.quantity,OLD.recipient,OLD.subject,OLD.body,OLD.revision,OLD.created_at)
 THEN RAISE EXCEPTION 'RFQ content is immutable; create a new draft'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER rfq_content_guard BEFORE UPDATE OR DELETE ON rfq_drafts FOR EACH ROW EXECUTE FUNCTION rfq_content_immutable();
CREATE TABLE external_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
 rfq_id uuid NOT NULL REFERENCES rfq_drafts(id), payload jsonb NOT NULL, payload_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('approved','dispatching','sent','outcome_unknown','blocked','cancelled')),
 transport text NOT NULL DEFAULT 'disabled', receipt text, blocked_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
);
CREATE TABLE supplier_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rfq_id uuid NOT NULL REFERENCES rfq_drafts(id),
 source text NOT NULL, received_at timestamptz NOT NULL, message_id text, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(rfq_id,message_id)
);
CREATE TRIGGER supplier_replies_immutable BEFORE UPDATE OR DELETE ON supplier_replies FOR EACH ROW EXECUTE FUNCTION sourcing_records_immutable();
CREATE INDEX rfq_drafts_candidate ON rfq_drafts(candidate_id,created_at);
CREATE INDEX external_actions_ready ON external_actions(state,created_at);
ALTER TABLE settings_proposals DROP CONSTRAINT settings_proposals_status_check;
ALTER TABLE settings_proposals ADD CONSTRAINT settings_proposals_status_check CHECK(status IN ('pending','approved','rejected','stale'));

CREATE FUNCTION external_action_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'External action records cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.approval_id,NEW.rfq_id,NEW.payload,NEW.payload_hash,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.approval_id,OLD.rfq_id,OLD.payload,OLD.payload_hash,OLD.created_at)
 THEN RAISE EXCEPTION 'External action payload is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER external_action_content_guard BEFORE UPDATE OR DELETE ON external_actions FOR EACH ROW EXECUTE FUNCTION external_action_content_immutable();
CREATE INDEX external_actions_rfq ON external_actions(rfq_id);
ALTER TABLE external_actions ADD COLUMN last_checked_at timestamptz;
