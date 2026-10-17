// All SQLite access for the engine, via the shared @airadio/db schema.
//
// The DB is the station's only source of truth for who the presenters are and
// what is scheduled — the web UI writes those tables while the engine runs, so
// every read here is fresh (no cached persona constants, nothing memoized
// across scheduler ticks).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "@airadio/db";
import { config } from "./config.ts";
import type { ScheduleSnapshot } from "./scheduler/resolveActiveSlot.ts";
import type {
  CollectionRow,
  PresenterRow,
  ScheduleSlotRow,
  TriggerType,
} from "./scheduler/types.ts";

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db === undefined) {
    db = config.dbPath === "" ? openDb() : openDb(config.dbPath);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

export interface TrackRow {
  id: number;
  collection_id: number;
  file_path: string;
  title: string | null;
  /** Nullable: the current library has titles but no artist tags. */
  artist: string | null;
  /** ffprobe-derived at ingest. The scheduler uses it to know when the next
   *  music boundary lands, so a pre-rendered clip can be pushed just in time. */
  duration_seconds: number | null;
  last_played_at: string | null;
  play_count: number;
}

interface AudioProbe {
  duration_seconds: number | null;
  title: string | null;
  artist: string | null;
}

/**
 * Probe an audio file's duration and title/artist ID3 tags with ffprobe
 * (provided by the devShell). Returns nulls rather than throwing — missing
 * metadata is not worth failing a seed over.
 *
 * Mirrors apps/web/src/lib/server/audio.ts's `probeAudio` (same ffprobe
 * flags, same JSON shape, same case-insensitive tag lookup) rather than
 * sharing a helper package — apps/engine and apps/web are separate
 * workspaces and this is the only thing between them that would want one,
 * so a second ~20-line copy is more pragmatic than a new shared package.
 */
function probeAudioTags(filePath: string): AudioProbe {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration:format_tags=title,artist",
        "-of", "json",
        filePath,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    const parsed = JSON.parse(out) as {
      format?: { duration?: string; tags?: Record<string, string> };
    };
    const rawDuration = parsed.format?.duration;
    const duration =
      rawDuration === undefined ? NaN : Number.parseFloat(rawDuration);
    return {
      duration_seconds: Number.isFinite(duration) ? duration : null,
      title: pickTag(parsed.format?.tags, "title"),
      artist: pickTag(parsed.format?.tags, "artist"),
    };
  } catch {
    return { duration_seconds: null, title: null, artist: null };
  }
}

/** ID3 tag keys come back with inconsistent casing depending on the container. */
function pickTag(tags: Record<string, string> | undefined, key: string): string | null {
  if (!tags) return null;
  const found = Object.entries(tags).find(([k]) => k.toLowerCase() === key);
  const value = found?.[1]?.trim();
  return value ? value : null;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Inserts the collection row if absent; returns its id. */
export function ensureCollection(name: string): number {
  const d = getDb();
  const existing = d
    .prepare("SELECT id FROM collections WHERE name = ?")
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;

  d.prepare(
    "INSERT INTO collections (name, mood_tag, description) VALUES (?, ?, ?)",
  ).run(
    name,
    "somber / late night",
    "Phase 1 seed collection of synthetic placeholder tracks.",
  );
  return (d.prepare("SELECT last_insert_rowid() AS id").get() as { id: number })
    .id;
}

/**
 * Makes the `tracks` table reflect the mp3s actually on disk for a collection.
 * Idempotent, and deduped on `checksum` per the schema's intent, so running it
 * on every boot is cheap and safe.
 *
 * This is a Phase 2 stopgap: without it, a fresh clone has mp3s on disk but an
 * empty `tracks` table, which would leave /next-music permanently broken. The
 * real ingest path is Phase 4's upload pipeline (probe + write + insert).
 */
export function seedCollectionFromDisk(collectionName: string): number {
  const d = getDb();
  const collectionId = ensureCollection(collectionName);
  const dir = join(config.libraryDir, collectionName);

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".mp3"))
      .sort();
  } catch {
    console.warn(`[store] collection directory not readable: ${dir}`);
    return 0;
  }

  const insert = d.prepare(
    `INSERT INTO tracks
       (collection_id, file_path, title, artist, duration_seconds, sort_order, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const findByPath = d.prepare(
    "SELECT id FROM tracks WHERE collection_id = ? AND file_path = ?",
  );
  const findByChecksum = d.prepare(
    "SELECT id FROM tracks WHERE collection_id = ? AND checksum = ?",
  );

  let added = 0;
  files.forEach((file, index) => {
    const absolute = join(dir, file);
    if (findByPath.get(collectionId, absolute)) return;

    const checksum = sha256(absolute);
    if (findByChecksum.get(collectionId, checksum)) return; // same audio, renamed

    const probe = probeAudioTags(absolute);
    insert.run(
      collectionId,
      absolute,
      probe.title ?? file.replace(/\.mp3$/i, ""),
      probe.artist,
      probe.duration_seconds,
      index,
      checksum,
    );
    added += 1;
  });

  if (added > 0) {
    console.log(
      `[store] seeded ${added} track(s) into collection "${collectionName}"`,
    );
  }
  return collectionId;
}

/**
 * No-immediate-repeat shuffle, using only `tracks.last_played_at` /
 * `play_count` as the plan specifies (no extra tables).
 *
 * Strategy: drop the track that just played, sort the rest least-recently-played
 * first (never-played first), keep the older half as the eligible pool, then pick
 * randomly from that pool. Picking strictly-oldest would degrade into a fixed
 * round-robin on a small collection; picking from the whole set would allow
 * near-repeats. Halving gives real variety with a guaranteed gap.
 */
export function pickNextTrack(
  collectionId: number,
  excludeTrackId?: number,
): TrackRow | undefined {
  const rows = getDb()
    .prepare(
      `SELECT id, collection_id, file_path, title, artist, duration_seconds,
              last_played_at, play_count
         FROM tracks
        WHERE collection_id = ?
        ORDER BY (last_played_at IS NULL) DESC, last_played_at ASC, sort_order ASC`,
    )
    .all(collectionId) as unknown as TrackRow[];

  if (rows.length === 0) return undefined;

  const candidates =
    rows.length > 1 && excludeTrackId !== undefined
      ? rows.filter((r) => r.id !== excludeTrackId)
      : rows;
  if (candidates.length === 0) return rows[0];

  const poolSize = Math.max(1, Math.ceil(candidates.length / 2));
  const pool = candidates.slice(0, poolSize);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function markTrackPlayed(trackId: number): void {
  getDb()
    .prepare(
      `UPDATE tracks
          SET last_played_at = datetime('now'), play_count = play_count + 1
        WHERE id = ?`,
    )
    .run(trackId);
}

/**
 * Everything the scheduler needs to answer "who is on air" — read in one go,
 * fresh, on every tick. Three small table scans; the whole schedule is a few
 * dozen rows, so this is cheaper than any cache-invalidation scheme would be,
 * and it means an edit made in the web UI is live within one tick.
 */
export function loadScheduleSnapshot(): ScheduleSnapshot {
  const d = getDb();
  const slots = d
    .prepare(
      `SELECT id, recurrence_type, day_of_week, specific_date, start_time,
              end_time, presenter_id, collection_id, priority, enabled
         FROM schedule_slots`,
    )
    .all() as unknown as ScheduleSlotRow[];

  const presenters = d
    .prepare(
      `SELECT id, name, station_role, tone_description, system_prompt,
              voice_archetype_notes, elevenlabs_voice_id, active
         FROM presenters`,
    )
    .all() as unknown as PresenterRow[];

  const collections = d
    .prepare("SELECT id, name, mood_tag, description FROM collections")
    .all() as unknown as CollectionRow[];

  return {
    slots,
    presenters: new Map(presenters.map((p) => [p.id, p])),
    collections: new Map(collections.map((c) => [c.id, c])),
  };
}

export function getPresenter(id: number): PresenterRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, name, station_role, tone_description, system_prompt,
              voice_archetype_notes, elevenlabs_voice_id, active
         FROM presenters WHERE id = ?`,
    )
    .get(id) as unknown as PresenterRow | undefined;
}

export interface ReadyClipRow {
  id: number;
  trigger_type: TriggerType;
  audio_path: string;
  script_text: string | null;
  duration_seconds: number | null;
  context_json: string;
}

/**
 * Clips that finished rendering but never aired — i.e. ones the scheduler
 * pre-rendered and was about to push when the process stopped.
 *
 * Restarting the engine while a clip is in that window would otherwise orphan
 * it forever: the dedupe key already exists so it is never regenerated, but the
 * in-memory delivery queue is gone. The scheduler replays these on boot.
 */
export function listUndeliveredClips(): ReadyClipRow[] {
  return getDb()
    .prepare(
      `SELECT id, trigger_type, audio_path, script_text, duration_seconds,
              context_json
         FROM generated_clips
        WHERE status = 'ready' AND audio_path IS NOT NULL
        ORDER BY id`,
    )
    .all() as unknown as ReadyClipRow[];
}

export type ClipStatus = "pending" | "rendering" | "ready" | "failed" | "used";

/** Opens a `generated_clips` row at status 'pending'; returns its id. */
export function createClip(args: {
  triggerType: TriggerType;
  presenterId: number;
  scheduleSlotId?: number | null;
  context: unknown;
}): number {
  const d = getDb();
  d.prepare(
    `INSERT INTO generated_clips
       (trigger_type, presenter_id, schedule_slot_id, context_json, status)
     VALUES (?, ?, ?, ?, 'pending')`,
  ).run(
    args.triggerType,
    args.presenterId,
    args.scheduleSlotId ?? null,
    JSON.stringify(args.context),
  );
  return (d.prepare("SELECT last_insert_rowid() AS id").get() as { id: number })
    .id;
}

/**
 * Has this exact trigger instance already been generated?
 *
 * The dedupe key (trigger type + the instant it is for, e.g.
 * `hour_open:2026-10-10T23:00`) lives inside `context_json` rather than in a
 * column of its own, so this needs no schema change — `apps/web` shares the
 * schema file and adding a column would mean coordinating a migration for a
 * value only the engine ever reads. SQLite's JSON1 `json_extract` is built in.
 *
 * Checked against the DB, not just an in-process set, so restarting the engine
 * mid-hour doesn't re-fire a triad that already aired.
 */
export function clipExistsForDedupeKey(key: string): boolean {
  const row = getDb()
    .prepare(
      // 'failed' rows count as existing on purpose: one attempt per trigger
      // instance. Retrying every 5s through a 180s lookahead would turn one
      // Claude outage into dozens of paid retries for a single moment.
      `SELECT 1 AS found FROM generated_clips
        WHERE json_extract(context_json, '$.dedupeKey') = ?
        LIMIT 1`,
    )
    .get(key) as { found: number } | undefined;
  return row !== undefined;
}

export function updateClip(
  id: number,
  fields: {
    status?: ClipStatus;
    script_text?: string;
    voice_id_used?: string;
    audio_path?: string;
    duration_seconds?: number | null;
    markUsed?: boolean;
  },
): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const key of [
    "status",
    "script_text",
    "voice_id_used",
    "audio_path",
    "duration_seconds",
  ] as const) {
    const value = fields[key];
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.markUsed) sets.push("used_at = datetime('now')");
  if (sets.length === 0) return;

  values.push(id);
  getDb()
    .prepare(`UPDATE generated_clips SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
}

// --- station_state ----------------------------------------------------------
// The singleton row apps/web's /live page polls (see
// apps/web/src/lib/server/live.ts). The engine is its only writer; the web app
// only ever reads it. `last_heartbeat_at` is what makes the UI say ON AIR —
// live.ts treats a heartbeat older than 30s as "no engine", so the scheduler
// writes this every tick even when nothing else changed.

export interface StationStatePatch {
  current_item_type?: string | null;
  current_item_ref?: string | null;
  current_item_artist?: string | null;
  current_item_started_at?: string | null;
  current_item_duration?: number | null;
  up_next_item_type?: string | null;
  up_next_item_ref?: string | null;
  up_next_item_artist?: string | null;
  current_presenter_id?: number | null;
  current_collection_id?: number | null;
  current_schedule_slot_id?: number | null;
}

const STATION_STATE_COLUMNS = [
  "current_item_type",
  "current_item_ref",
  "current_item_artist",
  "current_item_started_at",
  "current_item_duration",
  "up_next_item_type",
  "up_next_item_ref",
  "up_next_item_artist",
  "current_presenter_id",
  "current_collection_id",
  "current_schedule_slot_id",
] as const;

/**
 * Upserts the singleton row, always bumping the heartbeat and `updated_at`.
 * Only the fields present in `patch` are touched, so a caller that knows just
 * the up-next item doesn't have to restate everything else.
 */
export function writeStationState(patch: StationStatePatch): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO station_state (id, last_heartbeat_at)
     VALUES (1, datetime('now'))
     ON CONFLICT(id) DO NOTHING`,
  ).run();

  const sets = ["last_heartbeat_at = datetime('now')", "updated_at = datetime('now')"];
  const values: (string | number | null)[] = [];
  for (const column of STATION_STATE_COLUMNS) {
    const value = patch[column];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  d.prepare(`UPDATE station_state SET ${sets.join(", ")} WHERE id = 1`).run(
    ...values,
  );
}

// --- mock news / weather source rows ----------------------------------------
// Read by MockNewsProvider / MockWeatherProvider (src/providers/). The rows are
// shaped like a real API response so swapping in a live provider is a
// code-level change behind the provider interface and nothing else.

export interface NewsItemRow {
  id: number;
  headline: string;
  body: string | null;
  category: string | null;
  source_label: string | null;
  mock_published_at: string;
}

export interface WeatherSnapshotRow {
  id: number;
  as_of: string;
  conditions_text: string;
  temp_value: number | null;
  temp_unit: string | null;
  high: number | null;
  low: number | null;
  forecast_text: string | null;
}

export function listNewsItems(limit: number): NewsItemRow[] {
  return getDb()
    .prepare(
      `SELECT id, headline, body, category, source_label, mock_published_at
         FROM news_items
        ORDER BY mock_published_at DESC, id DESC
        LIMIT ?`,
    )
    .all(limit) as unknown as NewsItemRow[];
}

export function latestWeatherSnapshot(): WeatherSnapshotRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, as_of, conditions_text, temp_value, temp_unit, high, low,
              forecast_text
         FROM weather_snapshots
        ORDER BY as_of DESC, id DESC
        LIMIT 1`,
    )
    .get() as unknown as WeatherSnapshotRow | undefined;
}

export function countRows(table: "news_items" | "weather_snapshots" | "collections"): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as { n: number };
  return row.n;
}

// --- station_settings --------------------------------------------------------
// The singleton row apps/web's /settings page writes (same id=1 pattern as
// station_state above). The engine only ever reads it — the real news/weather
// providers use the country to pick a language/locale and coordinates.

export interface StationSettingsRow {
  id: number;
  country: string;
  updated_at: string;
}

/**
 * Reads the settings row, creating it with the schema's default ("GB") if it
 * doesn't exist yet — mirrors writeStationState's upsert-on-read-or-write
 * pattern, so the engine never has to special-case "no row yet".
 */
export function getStationSettings(): StationSettingsRow {
  const d = getDb();
  d.prepare(
    `INSERT INTO station_settings (id) VALUES (1) ON CONFLICT(id) DO NOTHING`,
  ).run();
  return d
    .prepare("SELECT id, country, updated_at FROM station_settings WHERE id = 1")
    .get() as unknown as StationSettingsRow;
}

/** Convenience for callers that only want the ISO 3166-1 alpha-2 code. */
export function getCountry(): string {
  return getStationSettings().country;
}
