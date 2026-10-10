// Nightwatch Radio — shared SQLite schema, consumed by both apps/engine and
// apps/web. See /home/fidzod/.claude/plans/new-project-i-want-logical-chipmunk.md
// section 1 ("Data model") for the design rationale.

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS presenters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  station_role TEXT NOT NULL,
  tone_description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  voice_archetype_notes TEXT NOT NULL,
  elevenlabs_voice_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mood_tag TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  duration_seconds REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  last_played_at TEXT,
  play_count INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tracks_collection ON tracks(collection_id);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('weekly', 'date_override')),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  specific_date TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  presenter_id INTEGER NOT NULL REFERENCES presenters(id),
  collection_id INTEGER NOT NULL REFERENCES collections(id),
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_recurrence ON schedule_slots(recurrence_type);

CREATE TABLE IF NOT EXISTS generated_clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('song_intro', 'changeover', 'hour_open', 'news', 'weather', 'sign_off', 'filler')
  ),
  presenter_id INTEGER NOT NULL REFERENCES presenters(id),
  schedule_slot_id INTEGER REFERENCES schedule_slots(id),
  context_json TEXT NOT NULL,
  script_text TEXT,
  voice_id_used TEXT,
  audio_path TEXT,
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'rendering', 'ready', 'failed', 'used')
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_generated_clips_status ON generated_clips(status);

CREATE TABLE IF NOT EXISTS station_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_item_type TEXT,
  current_item_ref TEXT,
  current_item_started_at TEXT,
  current_item_duration REAL,
  up_next_item_type TEXT,
  up_next_item_ref TEXT,
  current_presenter_id INTEGER REFERENCES presenters(id),
  current_collection_id INTEGER REFERENCES collections(id),
  current_schedule_slot_id INTEGER REFERENCES schedule_slots(id),
  last_heartbeat_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headline TEXT NOT NULL,
  body TEXT,
  category TEXT,
  source_label TEXT,
  mock_published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weather_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  as_of TEXT NOT NULL DEFAULT (datetime('now')),
  conditions_text TEXT NOT NULL,
  temp_value REAL,
  temp_unit TEXT,
  high REAL,
  low REAL,
  forecast_text TEXT
);
`;

export function applySchema(db: { exec(sql: string): void }): void {
  db.exec(SCHEMA_SQL);
}
