// All SQLite access for the engine, via the shared @airadio/db schema.
//
// Phase 2 scope: enough persistence to prove the pipeline — seed the
// test-collection, serve no-immediate-repeat shuffle for /next-music, and
// track the `generated_clips` status lifecycle. Phase 3 adds schedule
// resolution and the `station_state` writer; Phase 4's upload pipeline
// replaces `seedCollectionFromDisk` with real user uploads.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "@airadio/db";
import { config } from "./config.ts";
import { toPresenterRow } from "./personas/wren.ts";

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db === undefined) db = openDb();
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

export interface TrackRow {
  id: number;
  file_path: string;
  title: string | null;
  last_played_at: string | null;
  play_count: number;
}

/**
 * Probe an audio file's duration with ffprobe (provided by the devShell).
 * Returns null rather than throwing — a missing duration is not worth failing
 * a seed over, and nothing in Phase 2 depends on it.
 */
function probeDurationSeconds(filePath: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    const parsed = Number.parseFloat(out.trim());
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
       (collection_id, file_path, title, duration_seconds, sort_order, checksum)
     VALUES (?, ?, ?, ?, ?, ?)`,
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

    insert.run(
      collectionId,
      absolute,
      file.replace(/\.mp3$/i, ""),
      probeDurationSeconds(absolute),
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
      `SELECT id, file_path, title, last_played_at, play_count
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

/** Inserts Wren's `presenters` row if absent; returns its id. */
export function ensurePresenter(): number {
  const d = getDb();
  const row = toPresenterRow();
  const existing = d
    .prepare("SELECT id FROM presenters WHERE name = ?")
    .get(row.name) as { id: number } | undefined;
  if (existing) return existing.id;

  d.prepare(
    `INSERT INTO presenters
       (name, station_role, tone_description, system_prompt, voice_archetype_notes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    row.name,
    row.station_role,
    row.tone_description,
    row.system_prompt,
    row.voice_archetype_notes,
  );
  return (d.prepare("SELECT last_insert_rowid() AS id").get() as { id: number })
    .id;
}

/**
 * Looks up the voice chosen for a presenter in the web UI's Presenters page
 * (`presenters.elevenlabs_voice_id`). Returns null if the presenter has none
 * set yet — callers should fall back to `config.elevenLabsVoiceId` in that
 * case, not fail the generation over it.
 */
export function getPresenterVoiceId(presenterId: number): string | null {
  const row = getDb()
    .prepare("SELECT elevenlabs_voice_id FROM presenters WHERE id = ?")
    .get(presenterId) as { elevenlabs_voice_id: string | null } | undefined;
  return row?.elevenlabs_voice_id ?? null;
}

export type ClipStatus = "pending" | "rendering" | "ready" | "failed" | "used";

/** Opens a `generated_clips` row at status 'pending'; returns its id. */
export function createClip(args: {
  triggerType: string;
  presenterId: number;
  context: unknown;
}): number {
  const d = getDb();
  d.prepare(
    `INSERT INTO generated_clips
       (trigger_type, presenter_id, context_json, status)
     VALUES (?, ?, ?, 'pending')`,
  ).run(args.triggerType, args.presenterId, JSON.stringify(args.context));
  return (d.prepare("SELECT last_insert_rowid() AS id").get() as { id: number })
    .id;
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
