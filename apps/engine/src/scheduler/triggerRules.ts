// When each of the seven moments fires. Pure functions over a schedule
// snapshot and an instant — no DB writes, no API calls, no wall clock — so the
// whole rule matrix can be driven through a simulated day in milliseconds
// (see src/test/simulateDay.ts).
//
// From the plan's §1:
//   1. song intro   probabilistic per music-track boundary (~15%), with cooldown
//   2. changeover   deterministic, once per boundary where collection/presenter
//                   actually changes, pre-rendered ~60-90s ahead
//   3. hour open    deterministic, every hour at :00 while a slot is active
//   4. news         deterministic, chained right after #3
//   5. weather      deterministic, chained right after #4
//   6. sign-off     deterministic, once, at the end of the broadcast day
//   7. filler       probabilistic (~10%), only where #1 didn't fire
//
// Priority: sign-off > changeover > hour-open/news/weather > intro/filler. A
// deterministic trigger firing skips the probabilistic roll, so segments never
// stack — enforced here by `suppressStacked` (between deterministic triggers)
// and by `deterministicNear` (between deterministic and probabilistic ones).

import { config } from "../config.ts";
import {
  nextScheduleChange,
  resolveActiveSlot,
  sameAir,
  type ScheduleSnapshot,
} from "./resolveActiveSlot.ts";
import type { ActiveSlot, TriggerType } from "./types.ts";

export const PRIORITY: Record<TriggerType, number> = {
  sign_off: 40,
  changeover: 30,
  hour_open: 20,
  news: 20,
  weather: 20,
  song_intro: 10,
  filler: 10,
};

export interface TriggerCandidate {
  triggerType: TriggerType;
  /** Stable identity of this trigger instance: type + the instant it is for.
   *  Two ticks noticing the same trigger produce the same key, so it is
   *  generated exactly once (store.clipExistsForDedupeKey). */
  dedupeKey: string;
  /** When the clip should air. */
  fireAt: Date;
  priority: number;
  /** Who is on air at `fireAt` — whose system_prompt and voice get used. */
  active: ActiveSlot;
  /** Chained moments air in index order within a chain (the hour triad). */
  chainId?: string;
  chainIndex: number;
  /** changeover only: the collection being handed off from. */
  outgoingCollectionName?: string;
  /** changeover only: true when this handoff lands on the hour and is
   *  standing in for the separate hour-open moment (see collectDeterministic)
   *  — the incoming presenter should mark the time and lead into news rather
   *  than just mark the mood shift. */
  leadsIntoNews?: boolean;
}

function iso(d: Date): string {
  return d.toISOString();
}

/** The next exact top-of-hour at or after `from`. */
export function nextTopOfHour(from: Date): Date {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setTime(next.getTime() + 3_600_000);
  }
  return next;
}

/**
 * Every deterministic trigger whose fire time falls inside
 * [now, now + horizonMs] — already de-stacked, highest priority first.
 */
export function collectDeterministic(
  snapshot: ScheduleSnapshot,
  now: Date,
  horizonMs = config.lookaheadSeconds * 1000,
): TriggerCandidate[] {
  const candidates: TriggerCandidate[] = [];
  const active = resolveActiveSlot(snapshot, now);
  const horizonEnd = now.getTime() + horizonMs;

  // --- sign-off: the current block ends and nothing follows -----------------
  if (active !== null) {
    const afterEnd = resolveActiveSlot(
      snapshot,
      new Date(active.endsAt.getTime() + 1_000),
    );
    if (afterEnd === null) {
      const fireAt = new Date(
        active.endsAt.getTime() - config.signOffLeadSeconds * 1000,
      );
      if (fireAt.getTime() >= now.getTime() && fireAt.getTime() <= horizonEnd) {
        candidates.push({
          triggerType: "sign_off",
          dedupeKey: `sign_off:${iso(active.endsAt)}`,
          fireAt,
          priority: PRIORITY.sign_off,
          active,
          chainIndex: 0,
        });
      }
    }
  }

  // --- hour open -> news -> weather, as one chain --------------------------
  // Computed before the changeover block below, which needs to know whether
  // it's landing on the hour.
  const hourAt = nextTopOfHour(now);
  const hourActive =
    hourAt.getTime() <= horizonEnd ? resolveActiveSlot(snapshot, hourAt) : null;

  // --- changeover: presenter or collection actually changes ----------------
  const change = nextScheduleChange(snapshot, now, horizonMs);
  const realChange =
    change !== null &&
    change.before !== null &&
    change.after !== null &&
    !sameAir(change.before, change.after)
      ? { at: change.at, before: change.before, after: change.after }
      : null;

  // A handoff landing on (or within the stack guard of) the hour absorbs the
  // separate hour-open moment instead of losing the bulletin to it: one
  // changeover, spoken by the incoming presenter, that also marks the hour
  // and leads into news. See suppressStacked for why this would otherwise
  // drop the whole triad (changeover outranks hour_open on priority).
  const absorbsHour =
    realChange !== null &&
    hourActive !== null &&
    Math.abs(realChange.at.getTime() - hourAt.getTime()) <
      config.stackGuardSeconds * 1000;

  if (realChange !== null) {
    candidates.push({
      triggerType: "changeover",
      dedupeKey: `changeover:${iso(realChange.at)}`,
      // Airs at the boundary itself: the handoff marks the change, it doesn't
      // pre-announce it. Generation starts up to `lookaheadSeconds` earlier,
      // which covers the plan's "pre-rendered ~60-90s ahead".
      fireAt: absorbsHour ? hourAt : realChange.at,
      priority: PRIORITY.changeover,
      // The incoming presenter speaks — by the time it airs the hour is
      // theirs, and the template is written from the arriving side.
      active: absorbsHour ? hourActive! : realChange.after,
      chainId: absorbsHour ? `hour:${iso(hourAt)}` : undefined,
      chainIndex: 0,
      outgoingCollectionName: realChange.before.collection.name,
      leadsIntoNews: absorbsHour,
    });
  }

  if (hourActive !== null) {
    const chainId = `hour:${iso(hourAt)}`;
    const triad: TriggerType[] = absorbsHour
      ? ["news", "weather"]
      : ["hour_open", "news", "weather"];
    const startIndex = absorbsHour ? 1 : 0;
    triad.forEach((triggerType, offset) => {
      candidates.push({
        triggerType,
        dedupeKey: `${triggerType}:${iso(hourAt)}`,
        fireAt: hourAt,
        priority: PRIORITY[triggerType],
        active: hourActive,
        chainId,
        chainIndex: startIndex + offset,
      });
    });
  }

  return suppressStacked(candidates);
}

/**
 * Drops any candidate that would air within `stackGuardSeconds` of a
 * higher-priority one. The station's slots start on the hour, so a changeover
 * and an hour-open are routinely the same instant — this is what keeps the
 * listener from getting a handoff and a time check back-to-back. Members of a
 * surviving chain are kept together (the triad is one segment, not three
 * stacked ones).
 */
export function suppressStacked(
  candidates: TriggerCandidate[],
): TriggerCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) => b.priority - a.priority || a.fireAt.getTime() - b.fireAt.getTime(),
  );
  const guardMs = config.stackGuardSeconds * 1000;
  const kept: TriggerCandidate[] = [];
  const droppedChains = new Set<string>();

  for (const candidate of ordered) {
    if (candidate.chainId && droppedChains.has(candidate.chainId)) continue;

    const clash = kept.find(
      (k) =>
        k.chainId !== candidate.chainId &&
        Math.abs(k.fireAt.getTime() - candidate.fireAt.getTime()) < guardMs,
    );
    if (clash) {
      if (candidate.chainId) droppedChains.add(candidate.chainId);
      continue;
    }
    kept.push(candidate);
  }

  return kept.sort(
    (a, b) =>
      a.fireAt.getTime() - b.fireAt.getTime() || a.chainIndex - b.chainIndex,
  );
}

export interface ProbabilisticRollInput {
  /** The music boundary being rolled for (end of the track just served). */
  boundaryAt: Date;
  /** True if any deterministic trigger airs within the stack guard of it. */
  deterministicNear: boolean;
  /** Is there a next track to introduce? */
  hasUpcomingTrack: boolean;
  /** Fire time of the last probabilistic clip, for the cooldown. */
  lastProbabilisticAt: Date | undefined;
  random: () => number;
}

/**
 * Rolls the two probabilistic triggers for one music boundary, in the plan's
 * order: song intro first, filler only if the intro didn't fire.
 */
export function rollProbabilistic(
  input: ProbabilisticRollInput,
): "song_intro" | "filler" | null {
  if (input.deterministicNear) return null;

  if (input.lastProbabilisticAt !== undefined) {
    const sinceMs =
      input.boundaryAt.getTime() - input.lastProbabilisticAt.getTime();
    if (sinceMs < config.probabilisticCooldownSeconds * 1000) return null;
  }

  if (input.hasUpcomingTrack && input.random() < config.songIntroProbability) {
    return "song_intro";
  }
  if (input.random() < config.fillerProbability) return "filler";
  return null;
}
