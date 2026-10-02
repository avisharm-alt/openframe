-- Permanent deletion by authors and maintainers.
-- A question nobody has practised is removed outright. One that other students have practised keeps an empty,
-- anonymous shell (no text, no author) so their history still resolves to "no longer available"; it is stamped here.
ALTER TABLE question ADD COLUMN deleted_at TEXT;
