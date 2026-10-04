-- Two-reviewer verification.
--
-- A revision may be marked review_status = 'student_reviewed' only when at least two different reviewers have
-- approved it, and neither of them authored the question or the revision. The application enforces this in
-- src/lib/services/moderation.ts; the triggers below make the database refuse the mark otherwise, so the
-- importer's owner-review note (or any hand-written SQL) can never produce a "verified" question.

CREATE INDEX review_revision_reviewer ON review(revision_id, reviewer_id);

-- Revisions marked reviewed under the earlier single-reviewer rule do not meet the new bar. They stay published,
-- but are shown as unverified until two reviewers have approved them. Each reset is written to the audit log.
INSERT INTO moderation_event (id, actor_id, action, question_id, revision_id, report_id, detail, created_at)
SELECT lower(hex(randomblob(16))), NULL, 'verification_reset', r.question_id, r.id, NULL,
       '{"reason":"two_reviewer_rule"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM question_revision r
WHERE r.review_status = 'student_reviewed'
  AND (SELECT COUNT(DISTINCT rv.reviewer_id) FROM review rv
       WHERE rv.revision_id = r.id AND rv.decision = 'approve' AND rv.reviewer_id IS NOT NULL
         AND rv.reviewer_id IS NOT r.author_id
         AND rv.reviewer_id IS NOT (SELECT q.author_id FROM question q WHERE q.id = r.question_id)) < 2;

UPDATE question_revision SET review_status = 'unreviewed', reviewed_by = NULL, reviewed_at = NULL
WHERE review_status = 'student_reviewed'
  AND (SELECT COUNT(DISTINCT rv.reviewer_id) FROM review rv
       WHERE rv.revision_id = question_revision.id AND rv.decision = 'approve' AND rv.reviewer_id IS NOT NULL
         AND rv.reviewer_id IS NOT question_revision.author_id
         AND rv.reviewer_id IS NOT (SELECT q.author_id FROM question q WHERE q.id = question_revision.question_id)) < 2;

CREATE TRIGGER revision_verified_needs_two_reviewers_update
BEFORE UPDATE OF review_status ON question_revision
WHEN NEW.review_status = 'student_reviewed'
  AND (SELECT COUNT(DISTINCT rv.reviewer_id) FROM review rv
       WHERE rv.revision_id = NEW.id AND rv.decision = 'approve' AND rv.reviewer_id IS NOT NULL
         AND rv.reviewer_id IS NOT NEW.author_id
         AND rv.reviewer_id IS NOT (SELECT q.author_id FROM question q WHERE q.id = NEW.question_id)) < 2
BEGIN
  SELECT RAISE(ABORT, 'student_reviewed requires approvals from two independent reviewers');
END;

-- A revision that is being created has no reviews yet, so it can never start out verified.
CREATE TRIGGER revision_verified_needs_two_reviewers_insert
BEFORE INSERT ON question_revision
WHEN NEW.review_status = 'student_reviewed'
BEGIN
  SELECT RAISE(ABORT, 'student_reviewed requires approvals from two independent reviewers');
END;
