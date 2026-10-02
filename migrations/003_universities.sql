-- Initial university directory. Existing Western records and courses are preserved.
INSERT OR IGNORE INTO university (id, slug, name, enabled)
VALUES (lower(hex(randomblob(16))), 'western', 'Western University', 1);

INSERT OR IGNORE INTO university (id, slug, name, enabled)
VALUES (lower(hex(randomblob(16))), 'uoft', 'University of Toronto', 1);

UPDATE university SET enabled = 1 WHERE slug IN ('western', 'uoft');

ALTER TABLE course_request ADD COLUMN university_slug TEXT;
