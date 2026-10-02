// Safe to import from client code (no server dependencies).
export const ATTESTATION_TEXT =
  "This is original practice content. It is not copied, reconstructed, or adapted from an actual university assessment. I have permission to share the submitted material.";

// ---- Shared study notes (private; see src/lib/services/notes.ts). Safe to import from client code.
export const NOTES_RETENTION_DAYS = 180;
export const NOTES_MAX_CHARS = 40_000;
export const NOTES_MAX_FILES = 5;
export const NOTES_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const NOTES_MAX_REQUEST_BYTES = 40 * 1024 * 1024;
export const NOTES_MIN_CHARS = 200;
export const NOTES_CONSENT_VERSION = "notes-v1";
export const NOTES_OWN_WORK_TEXT =
  "These notes are my own work. They are not my instructor’s slides or handouts, text copied from a textbook or from another person’s notes, or anything from a test, exam, quiz or graded assignment. They contain no names, student numbers or contact details (including in file properties or photo data).";
export const NOTES_AI_CONSENT_TEXT =
  "I agree that OpenFrame maintainers may read these notes and files and use them, including by putting them into third-party AI tools, to write practice questions. Those tools have their own terms and may keep what they receive, which OpenFrame cannot control. Questions made from my notes may be published after review, without my name.";
export const NOTES_FILES_NOTE =
  "You can attach any kind of document, image, audio or video: up to 5 files of 15 MB each. Programs, installers, web pages (.html) and .svg images are not accepted; save code as .txt. Files are stored privately, are not opened or processed by the server, and are not checked for personal details, so please check names, file properties and photo location data yourself.";
export const NOTES_PRIVACY_PROMISE = `Your notes and your name are never shown to other students or published, and only OpenFrame maintainers can read them. They are deleted automatically ${NOTES_RETENTION_DAYS} days after you send them, sooner if you delete them or your account.`;
