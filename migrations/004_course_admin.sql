-- Course administration: course requests can be marked handled instead of piling up forever.
-- 'added' = a maintainer created the course from the request; 'dismissed' = no action will be taken.
ALTER TABLE course_request ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','added','dismissed'));
ALTER TABLE course_request ADD COLUMN course_id TEXT REFERENCES course(id) ON DELETE SET NULL;
ALTER TABLE course_request ADD COLUMN handled_at TEXT;
