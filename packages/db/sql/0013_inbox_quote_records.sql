CREATE TABLE inbox_quote_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  inbox_message_id uuid NOT NULL REFERENCES inbox_messages(id),
  mode text NOT NULL CHECK (mode IN ('parsed','manual')),
  record_key text NOT NULL CHECK (length(record_key) BETWEEN 1 AND 128),
  quote_id uuid UNIQUE REFERENCES supplier_quotes(id),
  extraction jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inbox_message_id,mode,record_key)
);
CREATE TRIGGER inbox_quote_records_immutable
  BEFORE UPDATE OR DELETE ON inbox_quote_records
  FOR EACH ROW EXECUTE FUNCTION inbox_captures_immutable();
