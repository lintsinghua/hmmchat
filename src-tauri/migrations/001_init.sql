PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id                 TEXT PRIMARY KEY,
  title              TEXT    NOT NULL DEFAULT '',
  pinned             INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  prefs              TEXT    NOT NULL DEFAULT '{}',
  active_leaf_turn_id TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_turn_id  TEXT,
  text            TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_conversation
  ON turns (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS lanes (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  provider_id     TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  parent_lane_id  TEXT,
  hidden          INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lanes_conversation
  ON lanes (conversation_id, position);

CREATE TABLE IF NOT EXISTS replies (
  id            TEXT PRIMARY KEY,
  turn_id       TEXT    NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  lane_id       TEXT    NOT NULL,
  provider_id   TEXT    NOT NULL,
  model_id      TEXT    NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  status        TEXT    NOT NULL,
  text          TEXT    NOT NULL DEFAULT '',
  reasoning     TEXT,
  reasoning_ms  INTEGER,
  steps         TEXT    NOT NULL DEFAULT '[]',
  sources       TEXT    NOT NULL DEFAULT '[]',
  usage         TEXT,
  error         TEXT,
  opts          TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_turn
  ON replies (turn_id, lane_id, version);

CREATE TABLE IF NOT EXISTS providers (
  id         TEXT PRIMARY KEY,
  kind       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  base_url   TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  models     TEXT    NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
