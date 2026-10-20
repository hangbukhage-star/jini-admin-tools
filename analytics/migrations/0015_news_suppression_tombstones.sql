CREATE TABLE IF NOT EXISTS news_suppressed (
  source_url TEXT PRIMARY KEY,
  title_key TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_suppressed_event
  ON news_suppressed(start_date, title_key);
