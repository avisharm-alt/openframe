-- Private import records. These are never part of public question payloads.
CREATE TABLE question_bank_import (
  question_key TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE REFERENCES question(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  source_evidence TEXT NOT NULL DEFAULT '[]',
  owner_review_note TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL
);
