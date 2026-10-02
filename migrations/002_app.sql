-- OpenFrame application schema.

-- Roles are plain text on Better Auth's "user" table: student (default) | reviewer | maintainer.
CREATE TRIGGER user_role_default AFTER INSERT ON "user" WHEN NEW.role IS NULL
BEGIN UPDATE "user" SET role = 'student' WHERE id = NEW.id; END;

CREATE TABLE university (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE course (
  id TEXT PRIMARY KEY,
  university_id TEXT NOT NULL REFERENCES university(id),
  slug TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Optional offering/year metadata, kept separate from course identity.
CREATE TABLE course_context (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  academic_year TEXT
);

CREATE TABLE unit (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE topic (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- Publication state lives on the question; content, provenance and review metadata live on revisions.
CREATE TABLE question (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id),
  topic_id TEXT NOT NULL REFERENCES topic(id),
  author_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  public_attribution INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('draft','pending_review','changes_requested','published','rejected','withdrawn')),
  live_revision_id TEXT,
  withdrawn_reason TEXT,
  withdrawn_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX question_course_state ON question(course_id, state);
CREATE INDEX question_author ON question(author_id);

CREATE TABLE question_revision (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  author_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','pending','changes_requested','approved','rejected','superseded','withdrawn')),
  topic_id TEXT NOT NULL REFERENCES topic(id),
  stem TEXT NOT NULL DEFAULT '',
  learning_objective TEXT NOT NULL DEFAULT '',
  difficulty TEXT CHECK (difficulty IN ('introductory','intermediate','challenging')),
  context_tag TEXT,
  ai_provenance TEXT CHECK (ai_provenance IN ('ai_generated','ai_assisted')),
  ai_tool TEXT,
  ai_generated_on TEXT,
  check_description TEXT NOT NULL DEFAULT '',
  reference_text TEXT,
  reference_url TEXT,
  correct_option_id TEXT,
  attested_at TEXT,
  attestation_text TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','student_reviewed')),
  reviewed_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  UNIQUE (question_id, number)
);
CREATE INDEX revision_state ON question_revision(state);

-- Option ids are stable across revisions of a question.
CREATE TABLE question_option (
  id TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES question_revision(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (revision_id, id)
);

CREATE TABLE review (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES question_revision(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve','request_changes','reject')),
  checklist TEXT NOT NULL DEFAULT '{}',
  public_note TEXT,
  private_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE report (
  id TEXT PRIMARY KEY,
  question_id TEXT REFERENCES question(id) ON DELETE SET NULL,
  revision_id TEXT REFERENCES question_revision(id) ON DELETE SET NULL,
  reporter_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reporter_hash TEXT,
  category TEXT NOT NULL CHECK (category IN ('incorrect','ambiguous','irrelevant','prohibited','removal_request','other')),
  details TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','investigating','resolved','dismissed')),
  resolution_note TEXT,
  handled_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX report_state ON report(state, priority);

CREATE TABLE bookmark (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

-- user_id NULL = guest session (access is by unguessable session id).
CREATE TABLE practice_session (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('practice','self_test')),
  state TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress','finished','abandoned')),
  course_id TEXT REFERENCES course(id) ON DELETE SET NULL,
  config TEXT NOT NULL DEFAULT '{}',
  timer_seconds INTEGER,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX session_user ON practice_session(user_id, created_at);

CREATE TABLE session_question (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_session(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES question(id),
  revision_id TEXT NOT NULL REFERENCES question_revision(id),
  option_order TEXT NOT NULL,
  UNIQUE (session_id, position)
);

CREATE TABLE attempt (
  session_question_id TEXT PRIMARY KEY REFERENCES session_question(id) ON DELETE CASCADE,
  selected_option_id TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  is_correct INTEGER,
  answered_at TEXT NOT NULL
);

-- Append-only audit trail. `detail` must not contain personal data or private reviewer notes.
CREATE TABLE moderation_event (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  question_id TEXT,
  revision_id TEXT,
  report_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX event_question ON moderation_event(question_id, created_at);

CREATE TABLE course_request (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
