CREATE TABLE products (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 160),
  brand TEXT CHECK (brand IS NULL OR length(brand) BETWEEN 1 AND 120),
  brand_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, name_key, brand_key)
);
CREATE UNIQUE INDEX products_unique_identity ON products (workspace_id, name_key, COALESCE(brand_key, ''));

CREATE UNIQUE INDEX approved_purchases_id_workspace ON approved_purchases (id, workspace_id);

CREATE TABLE purchase_line_products (
  purchase_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  product_id UUID NOT NULL,
  source_description TEXT NOT NULL CHECK (length(source_description) BETWEEN 1 AND 240),
  description_key TEXT NOT NULL CHECK (length(description_key) BETWEEN 1 AND 240),
  review_version INTEGER NOT NULL CHECK (review_version >= 0),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','confirmed')),
  linked_by UUID NOT NULL REFERENCES users(id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (purchase_id, line_index),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id),
  FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id)
);
CREATE INDEX purchase_line_products_product ON purchase_line_products (workspace_id, product_id);

CREATE TABLE product_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  result_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','rename','link')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);
CREATE TABLE product_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  product_id UUID NOT NULL,
  purchase_id UUID,
  action TEXT NOT NULL CHECK (action IN ('create','rename','link')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id),
  FOREIGN KEY (purchase_id, workspace_id) REFERENCES approved_purchases(id, workspace_id)
);
CREATE TRIGGER product_requests_no_update BEFORE UPDATE OR DELETE ON product_requests
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
CREATE TRIGGER product_events_no_update BEFORE UPDATE OR DELETE ON product_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
