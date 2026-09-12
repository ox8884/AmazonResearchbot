CREATE TABLE inbox_message_links (
  inbox_message_id uuid PRIMARY KEY REFERENCES inbox_messages(id),
  rfq_id uuid NOT NULL REFERENCES rfq_drafts(id),
  supplier_reply_id uuid NOT NULL REFERENCES supplier_replies(id),
  linked_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER inbox_message_links_immutable
  BEFORE UPDATE OR DELETE ON inbox_message_links
  FOR EACH ROW EXECUTE FUNCTION inbox_captures_immutable();
CREATE INDEX inbox_messages_created ON inbox_messages(created_at DESC,id DESC);
