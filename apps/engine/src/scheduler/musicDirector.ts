// The music side of the station: which track /next-music hands LiquidSoap, and
// — just as importantly — when the next music boundary will be.
//
// Why it keeps a pre-picked "up next": LiquidSoap pulls /next-music itself when
// it needs a track, which is the only moment the engine learns a boundary
// happened. Picking one track ahead turns that into usable foresight:
//
//   - the song-intro template needs the track that is ENDING *and* the one
//     COMING UP, which is only knowable with a lookahead pick
//   - `station_state.up_next_*` has something real to show the live page
//   - the boundary at the end of the track just served is `now + duration`, so
//     a probabilistic clip rolled at serve time has the whole track's playtime
//     to generate in before it has to be pushed
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
  /** When the boundary lands (end of the track just served). */
  at: Date;
  /** The track that will be ending at the boundary. */
  endingTrack: TrackRow;
  /** The pre-picked follower, if the collection has one. */
  upcomingTrack: TrackRow | undefined;
  /** Who is on air as of the serve. */
  active: ActiveSlot;
}

export class MusicDirector {
  private served: ServedTrack | undefined;
  private upcoming: TrackRow | undefined;

  private readonly clock: Clock;
  /** Called once per served track with the boundary at that track's end. */
  private readonly onBoundary: (event: BoundaryEvent) => void;

  // Written out longhand rather than as TypeScript parameter properties: Node
  // runs these .ts files with type-stripping only, which rejects that syntax.
  constructor(clock: Clock, onBoundary: (event: BoundaryEvent) => void) {
    this.clock = clock;
    this.onBoundary = onBoundary;
  }

  /**
   * Hands out the next track for the given on-air slot, marks it played, and
   * announces the boundary at its end. Returns undefined when the active
   * collection has no tracks (caller answers 503 and LiquidSoap plays silence).
   */
  take(active: ActiveSlot): ServedTrack | undefined {
    const now = this.clock();

    // Drop a pre-pick that belongs to a collection we are no longer playing —
    // that is exactly what happens on the first pull after a changeover.
    let next = this.upcoming;
    if (next !== undefined && next.collection_id !== active.collection.id) {
      next = undefined;
    }
    if (next === undefined) {
      next = pickNextTrack(active.collection.id, this.served?.track.id);
    }
    if (next === undefined) {
      this.upcoming = undefined;
      return undefined;
    }

    markTrackPlayed(next.id);
    const durationSeconds = next.duration_seconds ?? ASSUMED_TRACK_SECONDS;
    const served: ServedTrack = {
      track: next,
      active,
      startedAt: now,
      durationSeconds,
      endsAt: new Date(now.getTime() + durationSeconds * 1000),
    };
    this.served = served;

    // Pre-pick the follower, excluding what we just served.
    this.upcoming = pickNextTrack(active.collection.id, next.id);

    this.onBoundary({
      at: served.endsAt,
      endingTrack: served.track,
      upcomingTrack: this.upcoming,
      active,
    });

    return served;
  }

  /** The track most recently handed to LiquidSoap, if any. */
  current(): ServedTrack | undefined {
    return this.served;
  }

  upNext(): TrackRow | undefined {
    return this.upcoming;
  }

  /** Forgets all state — used when the station goes off air, so the live page
   *  stops claiming a track is playing. */
  reset(): void {
    this.served = undefined;
    this.upcoming = undefined;
  }
}
