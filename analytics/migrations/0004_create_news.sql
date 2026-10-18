CREATE TABLE IF NOT EXISTS news_sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
  adapter TEXT NOT NULL DEFAULT 'generic', config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1, auto_publish INTEGER NOT NULL DEFAULT 0,
  images_allowed INTEGER NOT NULL DEFAULT 0,
  last_attempt TEXT, last_success TEXT, last_error TEXT, last_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS news_posts (
  id TEXT PRIMARY KEY, source_id TEXT, source_url TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','hidden')),
  data TEXT NOT NULL, candidate TEXT, locked INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '',
  checked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_public_dates ON news_posts(status,end_date,start_date);
CREATE INDEX IF NOT EXISTS news_source ON news_posts(source_id);
CREATE INDEX IF NOT EXISTS news_fingerprint ON news_posts(fingerprint);
CREATE TABLE IF NOT EXISTS news_images (
  id TEXT PRIMARY KEY, body BLOB NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS news_locks (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS news_seen (url TEXT PRIMARY KEY, source_id TEXT NOT NULL, checked_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS news_seen_source ON news_seen(source_id);
INSERT OR IGNORE INTO news_sources(id,name,url,adapter,config) VALUES
('woojin','우진문화공간','http://www.woojin.or.kr/sub/03_sub_04.html','woojin','{}'),
('sori','한국소리문화의전당','https://www.sori21.co.kr/site/1/menu/8/show/performance','sori','{}'),
('nihc','국립무형유산원','https://www.nihc.go.kr/planweb/board/list.9is?contentUid=ff8080816ed8ebd3016ee9793c53019c&boardUid=ff8080816ecaefcf016ecfc31e210243&subPath=','nihc','{}');
