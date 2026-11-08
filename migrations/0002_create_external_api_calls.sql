CREATE TABLE IF NOT EXISTS external_api_calls (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL DEFAULT 0,
 service TEXT NOT NULL,
 request_started_at DATETIME NOT NULL,
 response_received_at DATETIME,
 duration_ms INTEGER,
 request_method TEXT NOT NULL,
 request_url TEXT NOT NULL,
 request_headers TEXT,
 request_body TEXT,
 response_status INTEGER,
 response_status_text TEXT,
 response_headers TEXT,
 response_body TEXT,
 success INTEGER NOT NULL DEFAULT 0,
 error_name TEXT,
 error_message TEXT,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_external_api_calls_company_created
 ON external_api_calls(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_api_calls_service_created
 ON external_api_calls(service, created_at DESC);
