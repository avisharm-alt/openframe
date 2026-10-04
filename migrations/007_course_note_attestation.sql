-- Keeps the confirmation the uploader gave when adding a file (see NOTES_ATTESTATION_TEXT), the way question
-- submissions keep theirs. Uploads made before this migration have an empty value: their older wording was not recorded.
ALTER TABLE course_note ADD COLUMN attestation_text TEXT NOT NULL DEFAULT '';
