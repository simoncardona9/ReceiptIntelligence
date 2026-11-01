ALTER TABLE review_records
  ADD COLUMN confirmed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
  CHECK (confirmed_fields <@ ARRAY['merchant', 'totalMinor']::TEXT[]);

ALTER TABLE review_revisions
  ADD COLUMN before_confirmed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN after_confirmed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
