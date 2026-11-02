ALTER TABLE approved_purchases ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE approved_purchases ADD COLUMN archived_by UUID REFERENCES users(id);
ALTER TABLE approved_purchases ADD CONSTRAINT approved_purchases_archive_pair CHECK
  ((archived_at IS NULL AND archived_by IS NULL) OR (archived_at IS NOT NULL AND archived_by IS NOT NULL));
CREATE INDEX approved_purchases_workspace_active ON approved_purchases (workspace_id, approved_at DESC, id DESC)
  WHERE archived_at IS NULL;
CREATE INDEX approved_purchases_workspace_archived ON approved_purchases (workspace_id, archived_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
CREATE TABLE approved_record_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  purchase_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive','restore')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id)
);
CREATE TABLE approved_record_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  purchase_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive','restore')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id)
);
CREATE TRIGGER approved_record_requests_no_update BEFORE UPDATE OR DELETE ON approved_record_requests
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER approved_record_events_no_update BEFORE UPDATE OR DELETE ON approved_record_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
