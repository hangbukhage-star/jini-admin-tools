CREATE TABLE IF NOT EXISTS tool_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 30),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tool_comments_tool_created
  ON tool_comments (tool_id, created_at DESC, id DESC);
