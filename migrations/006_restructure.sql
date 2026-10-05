-- Restructure: OpenFrame moves from a student question bank to a community care-package network.
-- The old app is preserved in git history (tag `question-bank-final`).
-- Existing migrations 001-005 are never edited; this one removes what they created.

-- 1. Drop the question-bank domain, children first (foreign keys are enforced).
DROP TABLE attempt;
DROP TABLE session_question;
DROP TABLE practice_session;
DROP TABLE bookmark;
DROP TABLE report;
DROP TABLE review;
DROP TABLE question_option;
DROP TABLE question_bank_import;
DROP TABLE question_revision;
DROP TABLE question;
DROP TABLE course_note;
DROP TABLE course_request;
DROP TABLE topic;
DROP TABLE unit;
DROP TABLE course_context;
DROP TABLE course;
DROP TABLE university;

-- 2. Global roles. `user.role` is now `member` (default) or `admin`; volunteer and coordinator
--    are per-chapter roles stored in chapter_member (migration 007). The column stays server-controlled.
DROP TRIGGER user_role_default;
UPDATE "user" SET role = CASE role WHEN 'maintainer' THEN 'admin' ELSE 'member' END;
CREATE TRIGGER user_role_default AFTER INSERT ON "user" WHEN NEW.role IS NULL
BEGIN UPDATE "user" SET role = 'member' WHERE id = NEW.id; END;

-- 3. moderation_event becomes audit_event: one append-only log for roles, pledges, address views, etc.
--    `detail` must never hold addresses, phone numbers, notes or other personal data.
DROP INDEX event_question;
ALTER TABLE moderation_event RENAME TO audit_event;
ALTER TABLE audit_event DROP COLUMN question_id;
ALTER TABLE audit_event DROP COLUMN revision_id;
ALTER TABLE audit_event DROP COLUMN report_id;
ALTER TABLE audit_event ADD COLUMN chapter_id TEXT;
ALTER TABLE audit_event ADD COLUMN subject_type TEXT;
ALTER TABLE audit_event ADD COLUMN subject_id TEXT;
CREATE INDEX audit_chapter ON audit_event(chapter_id, created_at);
CREATE INDEX audit_subject ON audit_event(subject_type, subject_id, created_at);
CREATE INDEX audit_action ON audit_event(action, created_at);

-- Append-only. The single permitted change is the foreign-key action that clears actor_id
-- when an account is deleted.
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
WHEN NOT (
  OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
  AND OLD.id = NEW.id AND OLD.action = NEW.action AND OLD.detail = NEW.detail AND OLD.created_at = NEW.created_at
  AND OLD.chapter_id IS NEW.chapter_id AND OLD.subject_type IS NEW.subject_type AND OLD.subject_id IS NEW.subject_id
)
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
