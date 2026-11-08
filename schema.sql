CREATE TABLE IF NOT EXISTS oauth_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER,
 company_name TEXT,
 company_domain TEXT,
 api_domain TEXT,
 user_id INTEGER,
 user_name TEXT,
 access_token TEXT NOT NULL,
 refresh_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS temprory_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 token TEXT NOT NULL UNIQUE,
 header TEXT NOT NULL,
 payload TEXT NOT NULL,
 algorithm TEXT,
 token_type TEXT,
 signature TEXT NOT NULL,
 user_id INTEGER NOT NULL,
 company_id INTEGER NOT NULL,
 issued_at INTEGER,
 expires_at INTEGER,
 not_before INTEGER,
 jwt_id TEXT,
 token_source TEXT,
 first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 use_count INTEGER NOT NULL DEFAULT 1,
 last_request_method TEXT,
 last_request_path TEXT,
 last_request_ip TEXT,
 last_request_user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_temprory_tokens_company_expires
 ON temprory_tokens(company_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_temprory_tokens_user_expires
 ON temprory_tokens(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS user_capacities (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 pipedrive_user_id INTEGER NOT NULL,
 user_name TEXT,
 daily_capacity INTEGER NOT NULL,
 sort_order INTEGER DEFAULT 0,
 paused_until_date TEXT DEFAULT NULL,
 active INTEGER DEFAULT 1,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(company_id, pipedrive_user_id)
);

CREATE TABLE IF NOT EXISTS assignment_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 deal_id INTEGER NOT NULL,
 assigned_user_id INTEGER NOT NULL,
 assigned_user_name TEXT,
 score INTEGER,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_state (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL UNIQUE,
 last_assigned_user_id INTEGER,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 route_key TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 request_count INTEGER NOT NULL DEFAULT 0,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 request_received_at DATETIME,
 request TEXT,
 request_method TEXT,
 request_url TEXT,
 request_path TEXT,
 request_query TEXT,
 request_headers TEXT,
 request_body TEXT,
 request_ip TEXT,
 request_user_agent TEXT,
 request_content_type TEXT,
 request_country TEXT,
 UNIQUE(company_id, route_key, window_start)
);


CREATE TABLE IF NOT EXISTS webhook_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER,
 webhook_id TEXT,
 event_action TEXT,
 event_object TEXT,
 entity_id TEXT,
 payload TEXT,
 received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS external_api_calls (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL DEFAULT 0,
 service TEXT NOT NULL,
 call_source TEXT NOT NULL DEFAULT 'backend' CHECK(call_source IN ('backend', 'frontend')),
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

CREATE INDEX IF NOT EXISTS idx_external_api_calls_source_created
 ON external_api_calls(call_source, created_at DESC);
