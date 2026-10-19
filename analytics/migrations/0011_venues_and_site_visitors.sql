ALTER TABLE news_posts ADD COLUMN venue_group TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS site_visit_days (
  visit_date TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY(visit_date,visitor_hash)
);
CREATE TABLE IF NOT EXISTS site_visitor_counts (
  visit_date TEXT PRIMARY KEY,
  visitors INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS count_site_visitor AFTER INSERT ON site_visit_days
BEGIN
  INSERT INTO site_visitor_counts(visit_date,visitors) VALUES(NEW.visit_date,1)
  ON CONFLICT(visit_date) DO UPDATE SET visitors=visitors+1;
END;
