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
