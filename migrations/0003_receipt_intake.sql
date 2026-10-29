CREATE TABLE receipts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status = 'staged'),
  source_fingerprint CHAR(64) NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_fingerprint),
  UNIQUE (id, workspace_id)
);

CREATE TABLE receipt_sources (
  receipt_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (receipt_id, source_file_id),
  UNIQUE (receipt_id, position),
  UNIQUE (workspace_id, source_file_id),
  FOREIGN KEY (receipt_id, workspace_id) REFERENCES receipts(id, workspace_id)
);

CREATE TABLE receipt_intake_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  source_fingerprint CHAR(64) NOT NULL,
  receipt_id UUID NOT NULL REFERENCES receipts(id),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);

CREATE TABLE receipt_intake_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  receipt_id UUID NOT NULL REFERENCES receipts(id),
  action TEXT NOT NULL CHECK (action = 'receipt_staged'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER receipt_intake_audit_no_update
  BEFORE UPDATE OR DELETE ON receipt_intake_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
