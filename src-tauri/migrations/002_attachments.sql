-- Attachments live with the turn that carried them.
--
-- They are a JSON array on the turn rather than their own table: a turn's files
-- are only ever read back with the turn, nothing queries across them, and the
-- alternative — a table plus a cascade — would exist purely for tidiness. The
-- base64 payloads are deliberately not stored (see src/lib/attachments.ts), so
-- a row stays small.
ALTER TABLE turns ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
