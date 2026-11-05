CREATE TABLE review_reprocess_events (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  job_id UUID NOT NULL UNIQUE REFERENCES extraction_jobs(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  old_proposal_id UUID NOT NULL REFERENCES receipt_proposals(id),
  new_proposal_id UUID NOT NULL REFERENCES receipt_proposals(id),
  before_fields JSONB NOT NULL CHECK (jsonb_typeof(before_fields) = 'object'),
  after_fields JSONB NOT NULL CHECK (jsonb_typeof(after_fields) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (review_id, workspace_id) REFERENCES review_records(id, workspace_id)
);

CREATE TRIGGER review_reprocess_events_no_update
  BEFORE UPDATE OR DELETE ON review_reprocess_events
  FOR EACH ROW EXECUTE FUNCTION reject_source_audit_mutation();
