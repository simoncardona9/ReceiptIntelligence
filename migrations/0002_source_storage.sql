CREATE TABLE source_files (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  storage_key UUID NOT NULL UNIQUE,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES users(id),
  CHECK ((removed_at IS NULL AND removed_by IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL))
);

CREATE INDEX source_files_workspace_uploaded ON source_files (workspace_id, uploaded_at DESC);

CREATE TABLE source_upload_idempotency (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);

CREATE TABLE source_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  action TEXT NOT NULL CHECK (action IN ('source_uploaded', 'source_downloaded', 'source_removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX source_audit_workspace_time ON source_audit_events (workspace_id, created_at);

CREATE FUNCTION reject_source_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER source_audit_events_no_update
  BEFORE UPDATE OR DELETE ON source_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
