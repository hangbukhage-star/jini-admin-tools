ALTER TABLE news_posts ADD COLUMN candidate_ignored TEXT;

-- Re-enable the free official class listings, previously paused during rollout.
UPDATE news_sources SET enabled=1 WHERE id='deureuri-jeonbuk';
