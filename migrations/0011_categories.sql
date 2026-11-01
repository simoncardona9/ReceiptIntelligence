CREATE TABLE categories (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  parent_id UUID,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
  classification TEXT CHECK (classification IN ('fixed','variable','discretionary')),
  source TEXT NOT NULL CHECK (source IN ('proyecto_finanzas','user')),
  archived_at TIMESTAMPTZ,
  merged_into_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (parent_id, workspace_id) REFERENCES categories(id, workspace_id),
  FOREIGN KEY (merged_into_id, workspace_id) REFERENCES categories(id, workspace_id),
  CHECK (id IS DISTINCT FROM parent_id AND id IS DISTINCT FROM merged_into_id),
  CHECK (merged_into_id IS NULL OR archived_at IS NOT NULL)
);
CREATE UNIQUE INDEX categories_active_name ON categories
  (workspace_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name_key)
  WHERE archived_at IS NULL;
CREATE TABLE category_mappings (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_name TEXT NOT NULL CHECK (length(source_name) BETWEEN 1 AND 120),
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 120),
  category_id UUID NOT NULL,
  confirmed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_key),
  FOREIGN KEY (category_id, workspace_id) REFERENCES categories(id, workspace_id)
);
CREATE TABLE category_mutations (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  result_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('seed','create','map','archive','merge')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);
CREATE TABLE category_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  category_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('seed','create','map','archive','merge')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, workspace_id) REFERENCES categories(id, workspace_id)
);
CREATE TRIGGER category_mutations_no_update BEFORE UPDATE OR DELETE ON category_mutations
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER category_events_no_update BEFORE UPDATE OR DELETE ON category_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
