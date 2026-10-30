ALTER TABLE review_records DROP CONSTRAINT review_records_version_check;
ALTER TABLE review_records ADD CONSTRAINT review_records_version_check CHECK (version >= 0);
ALTER TABLE review_records ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'review'
  CHECK (lifecycle_status IN ('review', 'approved', 'rejected'));
ALTER TABLE review_records ADD COLUMN auto_approve BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE approved_purchases (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('receipt', 'manual')),
  origin_id UUID NOT NULL,
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  review_version INTEGER NOT NULL CHECK (review_version >= 0),
  approved_by UUID NOT NULL REFERENCES users(id),
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('manual', 'auto')),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id),
  UNIQUE (workspace_id, origin, origin_id),
  FOREIGN KEY (review_id, workspace_id) REFERENCES review_records(id, workspace_id)
);

CREATE TABLE review_lifecycle_requests (
  review_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'auto')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, actor_user_id, idempotency_key),
  FOREIGN KEY (review_id, workspace_id) REFERENCES review_records(id, workspace_id)
);

CREATE TABLE review_lifecycle_events (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'auto_enabled', 'auto_disabled')),
  review_version INTEGER NOT NULL CHECK (review_version >= 0),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (review_id, workspace_id) REFERENCES review_records(id, workspace_id)
);

CREATE TRIGGER review_lifecycle_requests_no_update
  BEFORE UPDATE OR DELETE ON review_lifecycle_requests
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER review_lifecycle_events_no_update
  BEFORE UPDATE OR DELETE ON review_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
