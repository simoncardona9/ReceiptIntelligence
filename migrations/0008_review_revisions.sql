CREATE UNIQUE INDEX receipt_proposals_id_workspace ON receipt_proposals (id, workspace_id);

CREATE TABLE review_records (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  origin TEXT NOT NULL CHECK (origin IN ('receipt', 'manual')),
  origin_id UUID NOT NULL,
  base_proposal_id UUID,
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, origin, origin_id),
  UNIQUE (id, workspace_id),
  CHECK ((origin = 'receipt' AND base_proposal_id IS NOT NULL) OR (origin = 'manual' AND base_proposal_id IS NULL)),
  FOREIGN KEY (base_proposal_id, workspace_id) REFERENCES receipt_proposals(id, workspace_id)
);

CREATE TABLE review_revisions (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  before_fields JSONB NOT NULL CHECK (jsonb_typeof(before_fields) = 'object'),
  after_fields JSONB NOT NULL CHECK (jsonb_typeof(after_fields) = 'object'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, version),
  UNIQUE (review_id, actor_user_id, idempotency_key),
  FOREIGN KEY (review_id, workspace_id) REFERENCES review_records(id, workspace_id)
);

CREATE TRIGGER review_revisions_no_update
  BEFORE UPDATE OR DELETE ON review_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();

CREATE TABLE review_audit_events (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action = 'review_corrected'),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (review_id, workspace_id) REFERENCES review_records(id, workspace_id)
);

CREATE TRIGGER review_audit_events_no_update
  BEFORE UPDATE OR DELETE ON review_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
