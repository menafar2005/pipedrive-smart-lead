ALTER TABLE external_api_calls
 ADD COLUMN call_source TEXT NOT NULL DEFAULT 'backend'
 CHECK(call_source IN ('backend', 'frontend'));

CREATE INDEX IF NOT EXISTS idx_external_api_calls_source_created
 ON external_api_calls(call_source, created_at DESC);
