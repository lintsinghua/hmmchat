-- Which conversation a fork came from.
--
-- Provenance only. The forked conversation owns copies of the turns it was cut
-- around, so deleting or editing the ancestor never changes it; this column
-- exists so the UI can say where it came from, not so history can be shared.
ALTER TABLE conversations ADD COLUMN forked_from TEXT;
