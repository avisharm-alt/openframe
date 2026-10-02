-- Private study notes that students share so volunteers can write practice questions from them.
-- Never shown to other students and never published. Readable only by the author (title/status) and maintainers.
-- Deleted with the account, by the author, by a maintainer, or automatically after the retention period.
CREATE TABLE resource_note (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','used','declined')),
  flags TEXT NOT NULL DEFAULT '[]',
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX resource_note_user ON resource_note(user_id, created_at);

-- Uploaded files. The bytes live on disk (outside the database, so backups of the database never hold them and deleted or
-- expired files do not linger there); this table holds only metadata. The file on disk is named after id.
CREATE TABLE note_file (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES resource_note(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX note_file_note ON note_file(note_id);
CREATE INDEX resource_note_created ON resource_note(created_at);
