CREATE TABLE receipt_proposals (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  receipt_id UUID NOT NULL,
  job_id UUID NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  proposal JSONB NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (receipt_id, workspace_id) REFERENCES receipts(id, workspace_id),
  FOREIGN KEY (job_id, workspace_id) REFERENCES extraction_jobs(id, workspace_id)
);

CREATE INDEX receipt_proposals_latest ON receipt_proposals
  (workspace_id, receipt_id, created_at DESC);

CREATE TRIGGER receipt_proposals_no_update
  BEFORE UPDATE OR DELETE ON receipt_proposals
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
