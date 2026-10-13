-- How an OpenAI-compatible endpoint wants reasoning depth, when the app's
-- inference from the model id is wrong for it.
--
-- NULL means "infer from the model id", which is right for endpoints that relay
-- a vendor protocol. A self-hosted server that takes a numeric budget, or one
-- that rejects unknown fields outright, sets this instead.
ALTER TABLE providers ADD COLUMN reasoning_wire TEXT;
