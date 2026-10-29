CREATE TABLE manual_expenses (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status = 'staged'),
  merchant TEXT NOT NULL CHECK (length(merchant) BETWEEN 1 AND 160),
  expense_date DATE NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  currency CHAR(3) NOT NULL CHECK (currency IN ('UYU', 'USD')),
  category_name TEXT CHECK (category_name IS NULL OR length(category_name) BETWEEN 1 AND 120),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);

CREATE INDEX manual_expenses_workspace_created ON manual_expenses (workspace_id, created_at DESC);

CREATE TABLE manual_expense_lines (
  id UUID PRIMARY KEY,
  expense_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  quantity_milli BIGINT NOT NULL CHECK (quantity_milli > 0),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  UNIQUE (expense_id, position),
  FOREIGN KEY (expense_id, workspace_id) REFERENCES manual_expenses(id, workspace_id)
);

CREATE TABLE manual_expense_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  expense_id UUID NOT NULL REFERENCES manual_expenses(id),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);

CREATE TABLE manual_expense_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  expense_id UUID NOT NULL REFERENCES manual_expenses(id),
  action TEXT NOT NULL CHECK (action = 'manual_expense_staged'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER manual_expense_audit_no_update
  BEFORE UPDATE OR DELETE ON manual_expense_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
