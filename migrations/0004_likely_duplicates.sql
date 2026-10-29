CREATE TABLE receipt_intake_facts (
  receipt_id UUID PRIMARY KEY REFERENCES receipts(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  merchant_key TEXT NOT NULL CHECK (length(merchant_key) BETWEEN 1 AND 160),
  receipt_date DATE NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  currency CHAR(3) NOT NULL CHECK (currency IN ('UYU', 'USD')),
  entered_by UUID NOT NULL REFERENCES users(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receipt_intake_facts_match ON receipt_intake_facts
  (workspace_id, merchant_key, receipt_date, total_minor, currency);

CREATE TABLE receipt_duplicate_decisions (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  receipt_id UUID NOT NULL REFERENCES receipts(id),
  candidate_id UUID NOT NULL REFERENCES receipts(id),
  decision TEXT NOT NULL CHECK (decision IN ('same', 'different')),
  decided_by UUID NOT NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (receipt_id <> candidate_id),
  PRIMARY KEY (workspace_id, receipt_id, candidate_id)
);

CREATE TABLE receipt_duplicate_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  receipt_id UUID NOT NULL REFERENCES receipts(id),
  candidate_id UUID NOT NULL REFERENCES receipts(id),
  decision TEXT NOT NULL CHECK (decision IN ('same', 'different')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER receipt_duplicate_audit_no_update
  BEFORE UPDATE OR DELETE ON receipt_duplicate_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
