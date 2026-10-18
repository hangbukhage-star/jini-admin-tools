CREATE TABLE IF NOT EXISTS news_reactions (
  post_id TEXT NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK(reaction IN ('like','thanks','dislike','excited','cheer','sad')),
  PRIMARY KEY(post_id,visitor_hash)
);
