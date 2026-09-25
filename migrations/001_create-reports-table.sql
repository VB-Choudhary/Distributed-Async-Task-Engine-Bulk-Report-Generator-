-- Up Migration
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PERMANENTLY_FAILED')),
  params jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  file_path text,
  error_trace text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_reports_status ON reports (status);
CREATE INDEX idx_reports_created_at ON reports (created_at);

-- Down Migration
DROP INDEX IF EXISTS idx_reports_created_at;
DROP INDEX IF EXISTS idx_reports_status;
DROP TABLE IF EXISTS reports;
