CREATE TABLE purchase_allocations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  category_id UUID NOT NULL,
  line_indexes JSONB NOT NULL CHECK (jsonb_typeof(line_indexes) = 'array'),
  calculated_minor BIGINT NOT NULL CHECK (calculated_minor >= 0),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 500),
  kind TEXT NOT NULL CHECK (kind IN ('selected','remainder')),
  review_version INTEGER NOT NULL CHECK (review_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id),
  FOREIGN KEY (category_id, workspace_id) REFERENCES categories(id, workspace_id)
);
CREATE INDEX purchase_allocations_purchase ON purchase_allocations (workspace_id, purchase_id);
CREATE TABLE allocation_revisions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  purchase_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  before_allocations JSONB NOT NULL,
  after_allocations JSONB NOT NULL,
  review_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id)
);
CREATE TABLE allocation_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  revision_id UUID NOT NULL REFERENCES allocation_revisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);
CREATE TRIGGER allocation_revisions_no_update BEFORE UPDATE OR DELETE ON allocation_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER allocation_requests_no_update BEFORE UPDATE OR DELETE ON allocation_requests
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
