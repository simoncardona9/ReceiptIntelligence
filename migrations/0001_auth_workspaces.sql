CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE access_requests (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES users(id),
  decided_role TEXT CHECK (decided_role IN ('editor', 'viewer')),
  CHECK ((status = 'pending' AND decided_at IS NULL AND decided_by IS NULL AND decided_role IS NULL)
    OR (status = 'declined' AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND decided_role IS NULL)
    OR (status = 'approved' AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND decided_role IS NOT NULL))
);

CREATE UNIQUE INDEX access_requests_one_pending_per_user
  ON access_requests (workspace_id, user_id) WHERE status = 'pending';

CREATE INDEX access_requests_workspace_pending
  ON access_requests (workspace_id, requested_at) WHERE status = 'pending';

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  active_workspace_id UUID REFERENCES workspaces(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX auth_sessions_user_active ON auth_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_audit_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID REFERENCES workspaces(id),
  action TEXT NOT NULL CHECK (action IN (
    'account_registered', 'session_created', 'session_revoked',
    'workspace_created', 'workspace_selected', 'access_requested',
    'access_approved', 'access_declined'
  )),
  subject_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_audit_workspace_time ON auth_audit_events (workspace_id, created_at);

CREATE FUNCTION reject_auth_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'auth audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auth_audit_events_no_update
  BEFORE UPDATE OR DELETE ON auth_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_auth_audit_mutation();

CREATE TABLE idempotency_records (
  user_id UUID NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSONB NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, idempotency_key)
);
