CREATE TABLE course_note (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES course(id),
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  content BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX course_note_owner ON course_note(owner_id);
