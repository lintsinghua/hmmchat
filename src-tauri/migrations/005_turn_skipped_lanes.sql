-- The columns a question was deliberately not sent to.
--
-- Comparing models, the user can follow up with only some of them. The ones
-- left out have no answer for that turn, and must not be given the question as
-- context later either. "No reply" alone cannot say that: a column added after
-- a turn has no reply of its own there too, and it inherits its parent's
-- answer instead. So the omission is recorded on the turn.
--
-- A JSON array of lane ids. Empty means every column was asked.
ALTER TABLE turns ADD COLUMN skipped_lanes TEXT NOT NULL DEFAULT '[]';
