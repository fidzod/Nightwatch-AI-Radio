// The music side of the station: which track /next-music hands LiquidSoap, and
// — just as importantly — when the next music boundary will be, and what is
// *actually* playing right now versus merely queued up.
//
// The subtlety this file exists to handle: LiquidSoap's `request.dynamic`
// keeps exactly one track prefetched ahead at all times, resolving the next
// request a few seconds before the current one ends (to have it buffered for
// the crossfade). That means a call to `take()` does NOT hand back the track
// that's about to start playing — it hands back the track LiquidSoap is
// *prefetching*, which only actually starts audible playback on the *next*
// call to `take()` (confirmed empirically: watching real /next-music call
// timestamps against known track durations showed the gap between serve N
// and serve N+1 tracks the duration of the track served N-1, not N — i.e.
// a served track only starts playing one serve-call later than when it was
// handed out). Treating "most recently served" as "currently playing" (the
// original design) is exactly backwards by one: it showed the prefetched
// track as current and the one after that as "up next".
//
// So `take()` keeps two things, not one:
//   - `current_`: the track actually playing right now, promoted (with an
//     accurate startedAt) from whatever was prefetched on the *previous*
//     call — because this call happening is the signal that track started.
//   - `prefetched`: the track just handed to LiquidSoap this call, not yet
//     playing. This doubles as "up next" for display, and as the
//     `upcomingTrack` the song-intro template needs — no separate two-ahead
//     pre-pick is needed any more, since the prefetched track already *is*
//     what's genuinely queued up next.
//
// Collection resolution happens inside `take()`, per the plan: "the engine's
// /next-music endpoint resolves the currently active schedule_slot ->
// collection_id on every call, so collection changeover falls out for free".

import type { TrackRow } from "../store.ts";
import { markTrackPlayed, pickNextTrack } from "../store.ts";
import type { ActiveSlot, Clock } from "./types.ts";

/** Assumed track length when `tracks.duration_seconds` is null (un-probed
 *  file). Only affects boundary timing, never playback. */
const ASSUMED_TRACK_SECONDS = 180;

export interface ServedTrack {
  track: TrackRow;
  active: ActiveSlot;
  startedAt: Date;
  durationSeconds: number;
  /** Instant this track ends — i.e. the next music boundary. */
  endsAt: Date;
}

export interface BoundaryEvent {
  /** When the boundary lands (end of the track currently playing). */
  at: Date;
  /** The track that will be ending at the boundary. */
  endingTrack: TrackRow;
  /** The track already queued to follow it, if the collection has one. */
  upcomingTrack: TrackRow | undefined;
  /** Who is on air as of the serve. */
  active: ActiveSlot;
}

interface Prefetched {
  track: TrackRow;
  active: ActiveSlot;
}

export class MusicDirector {
  private current_: ServedTrack | undefined;
  private prefetched: Prefetched | undefined;

  private readonly clock: Clock;
  /** Called once per confirmed track start with the boundary at its end. */
  private readonly onBoundary: (event: BoundaryEvent) => void;

  // Written out longhand rather than as TypeScript parameter properties: Node
  // runs these .ts files with type-stripping only, which rejects that syntax.
  constructor(clock: Clock, onBoundary: (event: BoundaryEvent) => void) {
    this.clock = clock;
    this.onBoundary = onBoundary;
  }

  /**
   * Hands out the next track for the given on-air slot, marks it played, and
   * — once there is a previously-prefetched track to promote — announces the
   * boundary at its end. Returns undefined when the active collection has no
   * tracks (caller answers 503 and LiquidSoap plays silence).
   */
  take(active: ActiveSlot): TrackRow | undefined {
    const now = this.clock();

    // This call happening is the signal that whatever we prefetched last
    // call has now actually started playing.
    if (this.prefetched !== undefined) {
      this.promote(this.prefetched, now);
    }

    // Cold start: a fresh process (or genuinely the station's first ever
    // pull) has no memory of what's actually playing. There is no way to
    // tell those two cases apart from here, but the right heuristic covers
    // both: for a true first pull this guess is exactly correct (nothing
    // was playing before, so what we hand out now starts right away); for a
    // mid-stream engine restart it's a brief, self-correcting approximation
    // — one cycle of showing the about-to-play track as current beats
    // showing nothing for up to a full track's length.
    const coldStart = this.current_ === undefined && this.prefetched === undefined;

    const next = pickNextTrack(active.collection.id, this.current_?.track.id);
    if (next === undefined) {
      this.prefetched = undefined;
      return undefined;
    }
    markTrackPlayed(next.id);

    if (coldStart) {
      const served = this.promote({ track: next, active }, now);
      const following = pickNextTrack(active.collection.id, next.id);
      if (following === undefined) {
        this.prefetched = undefined;
      } else {
        markTrackPlayed(following.id);
        this.prefetched = { track: following, active };
      }
      this.onBoundary({
        at: served.endsAt,
        endingTrack: next,
        upcomingTrack: following,
        active,
      });
      return next;
    }

    this.prefetched = { track: next, active };

    if (this.current_ !== undefined) {
      this.onBoundary({
        at: this.current_.endsAt,
        endingTrack: this.current_.track,
        upcomingTrack: next,
        active: this.current_.active,
      });
    }

    return next;
  }

  private promote(prefetched: Prefetched, now: Date): ServedTrack {
    const { track, active } = prefetched;
    const durationSeconds = track.duration_seconds ?? ASSUMED_TRACK_SECONDS;
    const served: ServedTrack = {
      track,
      active,
      startedAt: now,
      durationSeconds,
      endsAt: new Date(now.getTime() + durationSeconds * 1000),
    };
    this.current_ = served;
    return served;
  }

  /** The track actually playing right now, if any. */
  current(): ServedTrack | undefined {
    return this.current_;
  }

  /** The track already queued up to play next — genuinely next, since it is
   *  what LiquidSoap has prefetched, not a further-ahead guess. */
  upNext(): TrackRow | undefined {
    return this.prefetched?.track;
  }

  /** Forgets all state — used when the station goes off air, so the live page
   *  stops claiming a track is playing. */
  reset(): void {
    this.current_ = undefined;
    this.prefetched = undefined;
  }
}
