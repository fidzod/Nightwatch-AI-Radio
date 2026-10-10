// Shared row/value shapes for the scheduler. These mirror
// packages/db/src/schema.ts (and apps/web/src/lib/types.ts) — SQLite hands back
// numbers for INTEGER/REAL, strings for TEXT, 0/1 for booleans.

export const TRIGGER_TYPES = [
  "song_intro",
  "changeover",
  "hour_open",
  "news",
  "weather",
  "sign_off",
  "filler",
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isTriggerType(value: string): value is TriggerType {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}

export interface PresenterRow {
  id: number;
  name: string;
  station_role: string;
  tone_description: string;
  system_prompt: string;
  voice_archetype_notes: string;
  elevenlabs_voice_id: string | null;
  active: number;
}

export interface CollectionRow {
  id: number;
  name: string;
  mood_tag: string | null;
  description: string | null;
}

export interface ScheduleSlotRow {
  id: number;
  recurrence_type: "weekly" | "date_override";
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  presenter_id: number;
  collection_id: number;
  priority: number;
  enabled: number;
}

/**
 * A resolved "who is on air" answer: the winning slot plus the live
 * `presenters`/`collections` rows it points at. Always read fresh from the DB
 * (the user edits both tables in the web UI while the engine runs), never
 * cached across ticks.
 */
export interface ActiveSlot {
  slot: ScheduleSlotRow;
  presenter: PresenterRow;
  collection: CollectionRow;
  /** Instant the winning slot's window opened. */
  startsAt: Date;
  /** Instant it closes (exclusive). Windows may wrap past midnight. */
  endsAt: Date;
}

/** Injected clock, so a simulated day can run without wall-clock waiting. */
export type Clock = () => Date;
