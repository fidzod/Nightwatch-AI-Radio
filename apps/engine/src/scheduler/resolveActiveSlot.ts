// "Who is on air at instant X" — the single answer every other part of the
// engine builds on (which collection /next-music serves from, whose
// system_prompt generates a script, which voice speaks it).
//
// The rules, from the plan's §1:
//   - a 'date_override' slot beats a 'weekly' slot for a date it covers
//   - higher `priority` wins within the same recurrence type
//   - `enabled = 0` slots are invisible
//   - slots whose presenter is missing or `active = 0` are invisible too
//   - windows may wrap past midnight (21:00 -> 01:00 is one window, not two)
//   - nothing covers "now" -> the station is off air (null), and /next-music
//     answers 503 so LiquidSoap's `mksafe` fallback plays silence
//
// Everything here is pure over a `ScheduleSnapshot` that the caller reads fresh
// from SQLite each tick. That matters: the user edits `presenters` and
// `schedule_slots` in the web UI while the engine runs, and those edits must
// take effect on the next tick — so nothing is cached across ticks, and the
// hardcoded persona constant Phase 2 used is gone. The DB is the only source
// of truth for who a presenter is.

import type {
  ActiveSlot,
  CollectionRow,
  PresenterRow,
  ScheduleSlotRow,
} from "./types.ts";

export interface ScheduleSnapshot {
  slots: ScheduleSlotRow[];
  presenters: Map<number, PresenterRow>;
  collections: Map<number, CollectionRow>;
}

const DAY_MS = 86_400_000;

/** Local-time YYYY-MM-DD, matching how `schedule_slots.specific_date` is written. */
export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-time HH:MM, matching `schedule_slots.start_time`/`end_time`. */
export function hhmm(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  // Via local components rather than +86400000ms, so a DST transition shifts
  // the window with the wall clock instead of sliding it an hour.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

function atTime(day: Date, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

interface Window {
  start: Date;
  end: Date;
}

/**
 * Every concrete instant-range this slot produces near `around` — one per
 * candidate anchor day (yesterday/today/tomorrow, which is enough for a window
 * that wraps at most once past midnight).
 */
function windowsNear(slot: ScheduleSlotRow, around: Date): Window[] {
  const windows: Window[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = addDays(startOfLocalDay(around), offset);
    if (slot.recurrence_type === "date_override") {
      if (slot.specific_date !== dateKey(day)) continue;
    } else if (slot.day_of_week !== day.getDay()) {
      continue;
    }

    const start = atTime(day, slot.start_time);
    let end = atTime(day, slot.end_time);
    if (start === null || end === null) continue;
    // end <= start means the window runs past midnight (21:00 -> 01:00), or is
    // a degenerate 00:00->00:00 "all day".
    if (end.getTime() <= start.getTime()) end = addDays(end, 1);
    windows.push({ start, end });
  }
  return windows;
}

/** date_override first, then priority, then lowest id — a total order, so the
 *  same instant always resolves to the same slot. */
function beats(a: ScheduleSlotRow, b: ScheduleSlotRow): boolean {
  const aOverride = a.recurrence_type === "date_override" ? 1 : 0;
  const bOverride = b.recurrence_type === "date_override" ? 1 : 0;
  if (aOverride !== bOverride) return aOverride > bOverride;
  if (a.priority !== b.priority) return a.priority > b.priority;
  return a.id < b.id;
}

/**
 * The slot on air at `at`, or null if the station is off air then.
 *
 * A slot whose presenter or collection row has been deleted resolves to null
 * rather than throwing — the station goes quiet and the web UI shows "off air",
 * which is the same graceful path as an empty schedule.
 */
export function resolveActiveSlot(
  snapshot: ScheduleSnapshot,
  at: Date,
): ActiveSlot | null {
  let best: { slot: ScheduleSlotRow; window: Window } | undefined;

  for (const slot of snapshot.slots) {
    if (!slot.enabled) continue;
    // A slot whose presenter has been retired (or deleted) is invisible,
    // same as a disabled slot. Defense in depth: stale/duplicate slot sets
    // left over from a renamed-away presenter must never out-rank the live
    // roster on the id tie-break just because nobody got around to deleting
    // them (see the legacy-presenter cleanup in backups/).
    const slotPresenter = snapshot.presenters.get(slot.presenter_id);
    if (!slotPresenter || !slotPresenter.active) continue;
    for (const window of windowsNear(slot, at)) {
      if (at.getTime() < window.start.getTime()) continue;
      if (at.getTime() >= window.end.getTime()) continue;
      if (best === undefined || beats(slot, best.slot)) {
        best = { slot, window };
      }
      break;
    }
  }

  if (best === undefined) return null;

  const presenter = snapshot.presenters.get(best.slot.presenter_id);
  const collection = snapshot.collections.get(best.slot.collection_id);
  if (!presenter || !collection) return null;

  return {
    slot: best.slot,
    presenter,
    collection,
    startsAt: best.window.start,
    endsAt: best.window.end,
  };
}

/**
 * First instant at or after `from` (and before `from + horizonMs`) where the
 * resolved answer stops being `current` — used both for changeover detection
 * and for finding the end of the broadcast day.
 *
 * Scans at `stepMs` (default 60s) because slot boundaries are HH:MM — there is
 * no sub-minute precision to find. Returns null if nothing changes in the
 * horizon. The returned instant is snapped to the minute so the same boundary
 * always produces the same dedupe key no matter which tick notices it.
 */
export function nextScheduleChange(
  snapshot: ScheduleSnapshot,
  from: Date,
  horizonMs: number,
  stepMs = 60_000,
): { at: Date; before: ActiveSlot | null; after: ActiveSlot | null } | null {
  const before = resolveActiveSlot(snapshot, from);
  const limit = from.getTime() + horizonMs;

  // Start from the next whole minute, so `at` is always minute-aligned.
  let cursor = new Date(Math.ceil(from.getTime() / stepMs) * stepMs);
  while (cursor.getTime() <= limit) {
    const after = resolveActiveSlot(snapshot, cursor);
    if (!sameAir(before, after)) return { at: cursor, before, after };
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return null;
}

/** Two resolutions are "the same air" if the listener would notice no change:
 *  same presenter and same collection. A slot id changing underneath (e.g. the
 *  weekly 21:00-01:00 row handing off to the next day's row at midnight) is
 *  deliberately NOT a changeover. */
export function sameAir(a: ActiveSlot | null, b: ActiveSlot | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.presenter.id === b.presenter.id && a.collection.id === b.collection.id
  );
}

export { DAY_MS };
