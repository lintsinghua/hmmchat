-- Files attached to a question.
--
-- Kept on the turn rather than in their own table: an attachment is only ever
-- read with its turn, and nothing queries across attachments. The extracted
-- text is small (bounded by the prompt budget); a PDF's extracted text is the
-- reason this stores anything at all rather than re-reading a file that the
-- app is not allowed to reach back into.
ALTER TABLE turns ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
