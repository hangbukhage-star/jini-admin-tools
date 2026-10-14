CREATE TABLE IF NOT EXISTS tool_counts (
  tool_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO tool_counts (tool_id) VALUES
  ('work-plan'),
  ('insurance-summary'),
  ('agenda-merger'),
  ('meeting-record-writer'),
  ('construction-photos'),
  ('pdf-editor'),
  ('file-compressor');
