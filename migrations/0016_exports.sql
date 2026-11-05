CREATE TABLE export_batches (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('full','correction')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  manifest JSONB NOT NULL,
  zip_bytes BYTEA NOT NULL,
  UNIQUE (workspace_id, actor_user_id, idempotency_key)
);
CREATE TABLE export_batch_records (
  batch_id UUID NOT NULL REFERENCES export_batches(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  purchase_id UUID NOT NULL,
  review_version INTEGER NOT NULL,
  supersedes_batch_id UUID REFERENCES export_batches(id),
  PRIMARY KEY (batch_id, purchase_id),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id)
);
CREATE INDEX export_batch_records_purchase ON export_batch_records (workspace_id, purchase_id, batch_id);
CREATE TABLE export_download_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  batch_id UUID NOT NULL REFERENCES export_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER export_batches_no_update BEFORE UPDATE OR DELETE ON export_batches
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER export_batch_records_no_update BEFORE UPDATE OR DELETE ON export_batch_records
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER export_download_events_no_update BEFORE UPDATE OR DELETE ON export_download_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
