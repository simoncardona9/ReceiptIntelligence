ALTER TABLE receipts DROP CONSTRAINT receipts_status_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_status_check
  CHECK (status IN ('staged', 'processing', 'failed', 'extracted', 'review'));

CREATE TABLE extraction_queue_controls (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id),
  paused BOOLEAN NOT NULL DEFAULT false,
  resource_paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE extraction_jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  receipt_id UUID NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry_wait', 'failed', 'completed', 'cancelled', 'stopped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_token UUID,
  safe_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (receipt_id, workspace_id) REFERENCES receipts(id, workspace_id),
  UNIQUE (id, workspace_id),
  CHECK ((status = 'running') = (run_token IS NOT NULL))
);

CREATE UNIQUE INDEX extraction_one_active_receipt
  ON extraction_jobs (workspace_id, receipt_id)
  WHERE status IN ('queued', 'running', 'retry_wait');
CREATE INDEX extraction_ready_jobs ON extraction_jobs
  (priority DESC, next_attempt_at, created_at)
  WHERE status IN ('queued', 'retry_wait');

CREATE TABLE extraction_job_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  receipt_id UUID NOT NULL REFERENCES receipts(id),
  job_id UUID NOT NULL REFERENCES extraction_jobs(id),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);

CREATE TABLE extraction_action_requests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key UUID NOT NULL,
  action TEXT NOT NULL,
  target_id UUID,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, idempotency_key)
);

CREATE TABLE extraction_evidence (
  job_id UUID PRIMARY KEY REFERENCES extraction_jobs(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  receipt_id UUID NOT NULL REFERENCES receipts(id),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  engine TEXT NOT NULL CHECK (engine IN ('paddle', 'tesseract')),
  device TEXT NOT NULL CHECK (device IN ('cpu', 'gpu')),
  pages JSONB NOT NULL CHECK (jsonb_typeof(pages) = 'array'),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, workspace_id) REFERENCES extraction_jobs(id, workspace_id)
);

CREATE TABLE extraction_job_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  job_id UUID REFERENCES extraction_jobs(id),
  receipt_id UUID REFERENCES receipts(id),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN (
    'submitted', 'started', 'retry_scheduled', 'failed', 'completed',
    'cancelled', 'prioritized', 'queue_paused', 'queue_resumed',
    'manual_retry', 'resource_paused', 'stopped', 'recovered'
  )),
  safe_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER extraction_job_events_no_update
  BEFORE UPDATE OR DELETE ON extraction_job_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
