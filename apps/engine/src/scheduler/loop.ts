// The station brain: a ~5s tick that resolves who is on air, pre-renders the
// moments that are coming, pushes finished clips just in time, and keeps
// `station_state` current for the live page.
//
// Two event sources drive it:
//   - the tick (wall clock): deterministic triggers — changeover, the
//     hour-open/news/weather triad, sign-off — plus delivery and heartbeat
//   - /next-music (LiquidSoap pulling a track): a music boundary, which is
//     where the probabilistic song-intro/filler rolls happen
//
// Everything slow is kept off the tick. A tick only reads SQLite and compares
// instants; Claude/ElevenLabs calls are started as detached promises and
// tracked in `pending`, so a 6-second generation never delays the next tick,
// and a failed one can't take the station off the air.
//
// All time comes from the injected `clock`, and all randomness from the
// injected `random` — that is what lets src/test/simulateDay.ts run a whole
// broadcast day through this exact code in milliseconds.

import { config } from "../config.ts";
import { formatStationTime } from "../generation/claude.ts";
import type { MomentContext } from "../generation/prompts.ts";
import {
  deliverMoment,
  generateMoment,
  type MomentPlan,
  type MomentResult,
} from "../moment.ts";
import {
  MockNewsProvider,
  type NewsProvider,
} from "../providers/newsProvider.ts";
import {
  MockWeatherProvider,
  type WeatherProvider,
} from "../providers/weatherProvider.ts";
import {
  clipExistsForDedupeKey,
  listUndeliveredClips,
  loadScheduleSnapshot,
  writeStationState,
  type TrackRow,
} from "../store.ts";
import { MusicDirector, type BoundaryEvent } from "./musicDirector.ts";
import { resolveActiveSlot, type ScheduleSnapshot } from "./resolveActiveSlot.ts";
import {
  PRIORITY,
  collectDeterministic,
  rollProbabilistic,
  type TriggerCandidate,
} from "./triggerRules.ts";
import type { ActiveSlot, Clock, TriggerType } from "./types.ts";

export interface SchedulerDeps {
  clock?: Clock;
  random?: () => number;
  news?: NewsProvider;
  weather?: WeatherProvider;
  /** Overridable so the simulation can exercise the rules without paying for
   *  Claude/ElevenLabs on every one of a day's moments. */
  generate?: (plan: MomentPlan) => Promise<MomentResult>;
  deliver?: (clipId: number, audioPath: string) => Promise<string | null>;
}

type PendingState = "generating" | "ready" | "aired" | "failed";

interface PendingMoment {
  key: string;
  triggerType: TriggerType;
  fireAt: Date;
  chainId?: string;
  chainIndex: number;
  state: PendingState;
  clipId?: number;
  audioPath?: string;
  scriptText?: string;
  durationSeconds?: number | null;
}

interface AiringSpeech {
  triggerType: TriggerType;
  scriptText: string;
  startedAt: Date;
  durationSeconds: number | null;
  until: Date;
}

/** What the scheduler decided on one tick — returned for tests/logging. */
export interface TickReport {
  now: Date;
  onAir: boolean;
  presenterName: string | null;
  collectionName: string | null;
  started: TriggerType[];
  delivered: TriggerType[];
}

export class Scheduler {
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly news: NewsProvider;
  private readonly weather: WeatherProvider;
  private readonly generate: (plan: MomentPlan) => Promise<MomentResult>;
  private readonly deliver: (
    clipId: number,
    audioPath: string,
  ) => Promise<string | null>;

  readonly music: MusicDirector;

  private pending: PendingMoment[] = [];
  private inFlight = new Set<string>();
  private lastProbabilisticAt: Date | undefined;
  private lastDeterministicFireAt: Date | undefined;
  private airing: AiringSpeech | undefined;
  private wasOnAir: boolean | undefined;
  private timer: NodeJS.Timeout | undefined;
  /** Promises for detached generations — awaited only by the simulation, so a
   *  simulated day can settle before asserting. */
  private readonly tasks = new Set<Promise<unknown>>();

  constructor(deps: SchedulerDeps = {}) {
    this.clock = deps.clock ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.news = deps.news ?? new MockNewsProvider();
    this.weather = deps.weather ?? new MockWeatherProvider();
    this.generate = deps.generate ?? generateMoment;
    this.deliver = deps.deliver ?? deliverMoment;
    this.music = new MusicDirector(this.clock, (event) =>
      this.onMusicBoundary(event),
    );
  }

  /**
   * Re-queues clips that were pre-rendered but never pushed (the engine was
   * restarted inside the pre-render window). Only those still inside the
   * delivery grace window are taken — an older one would air wildly out of
   * context, and its 'ready' status already records that it never went out.
   */
  private recoverPending(now: Date): number {
    let recovered = 0;
    for (const clip of listUndeliveredClips()) {
      let fireAt: Date;
      try {
        const parsed = JSON.parse(clip.context_json) as {
          fireAt?: string;
          dedupeKey?: string;
        };
        if (parsed.fireAt === undefined) continue;
        // Hand-fired clips (/trigger/<type>?deliver=false) are deliberately
        // generated-but-not-aired; never push one behind the user's back.
        if (parsed.dedupeKey?.startsWith("manual:")) continue;
        fireAt = new Date(parsed.fireAt);
      } catch {
        continue;
      }
      if (Number.isNaN(fireAt.getTime())) continue;
      if (now.getTime() > fireAt.getTime() + config.deliverGraceSeconds * 1000) {
        continue;
      }

      this.pending.push({
        key: `recovered:${clip.id}`,
        triggerType: clip.trigger_type,
        fireAt,
        chainIndex: 0,
        state: "ready",
        clipId: clip.id,
        audioPath: clip.audio_path,
        scriptText: clip.script_text ?? undefined,
        durationSeconds: clip.duration_seconds,
      });
      recovered += 1;
    }
    if (recovered > 0) {
      console.log(
        `[scheduler] recovered ${recovered} pre-rendered clip(s) still due for delivery`,
      );
    }
    return recovered;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.recoverPending(this.clock());
    console.log(
      `[scheduler] starting: ${config.tickSeconds}s tick, ` +
        `${config.lookaheadSeconds}s lookahead, intro ${config.songIntroProbability}, ` +
        `filler ${config.fillerProbability}`,
    );
    this.timer = setInterval(() => {
      void this.tick().catch((err: unknown) =>
        console.error("[scheduler] tick failed —", err),
      );
    }, config.tickSeconds * 1000);
    void this.tick().catch((err: unknown) =>
      console.error("[scheduler] first tick failed —", err),
    );
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Resolves awaiting every detached generation currently in flight. */
  async settle(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }

  // --- /next-music ----------------------------------------------------------

  /**
   * The schedule-aware half of GET /next-music: resolves who is on air right
   * now and hands out a track from THAT collection, which is what makes
   * collection changeover need no separate reload signal. Returns null when the
   * station is off air or the active collection is empty — the route answers
   * 503 and LiquidSoap's `mksafe` plays silence.
   *
   * Note this is the track LiquidSoap is *prefetching* — not necessarily what
   * is audible this instant (see musicDirector.ts). It's still the right
   * thing to hand back here: LiquidSoap needs a path to queue regardless, and
   * `MusicDirector.current()` is what the live page reads for "now playing".
   */
  takeNextTrack(): { track: TrackRow; active: ActiveSlot } | null {
    const snapshot = loadScheduleSnapshot();
    const active = resolveActiveSlot(snapshot, this.clock());
    if (active === null) {
      this.music.reset();
      return null;
    }
    const track = this.music.take(active);
    return track === undefined ? null : { track, active };
  }

  // --- the tick -------------------------------------------------------------

  async tick(): Promise<TickReport> {
    const now = this.clock();
    const snapshot = loadScheduleSnapshot();
    const active = resolveActiveSlot(snapshot, now);

    // Generation runs whether or not the station is currently on air: the hour
    // triad for the hour a slot OPENS on has to be generated in the minutes
    // before sign-on, while nothing is resolving yet. (Changeover and sign-off
    // both require an outgoing slot, so neither can be produced while off air.)
    const started = this.startDeterministic(snapshot, now);

    if (active === null) {
      if (this.wasOnAir !== false) {
        console.log("[scheduler] off air — no schedule slot covers now");
        this.wasOnAir = false;
      }
      // Nothing is delivered while off air — silence is the point. Anything
      // that was due during the gap ages out via dropStale.
      this.dropStale(now);
      this.music.reset();
      writeStationState({
        current_item_type: null,
        current_item_ref: null,
        current_item_started_at: null,
        current_item_duration: null,
        up_next_item_type: null,
        up_next_item_ref: null,
        current_presenter_id: null,
        current_collection_id: null,
        current_schedule_slot_id: null,
      });
      return {
        now,
        onAir: false,
        presenterName: null,
        collectionName: null,
        started,
        delivered: [],
      };
    }

    if (this.wasOnAir !== true) {
      console.log(
        `[scheduler] on air — ${active.presenter.name} / ${active.collection.name} ` +
          `(slot ${active.slot.id}, until ${active.endsAt.toISOString()})`,
      );
      this.wasOnAir = true;
    }

    const delivered = await this.deliverDue(now);
    this.dropStale(now);
    this.writeState(active, now);

    return {
      now,
      onAir: true,
      presenterName: active.presenter.name,
      collectionName: active.collection.name,
      started,
      delivered,
    };
  }

  // --- deterministic triggers ----------------------------------------------

  private startDeterministic(
    snapshot: ScheduleSnapshot,
    now: Date,
  ): TriggerType[] {
    const started: TriggerType[] = [];
    for (const candidate of collectDeterministic(snapshot, now)) {
      if (this.isKnown(candidate.dedupeKey)) continue;
      this.launch(candidate, now);
      started.push(candidate.triggerType);
    }
    return started;
  }

  /** Already generated (this process or a previous one), or in flight. */
  private isKnown(dedupeKey: string): boolean {
    if (this.inFlight.has(dedupeKey)) return true;
    if (this.pending.some((p) => p.key === dedupeKey)) return true;
    return clipExistsForDedupeKey(dedupeKey);
  }

  /**
   * Starts one moment: records it as pending, then kicks off generation as a
   * detached task so the tick never waits on Claude/ElevenLabs.
   *
   * `context` is passed in by the probabilistic path (song intro and filler get
   * their context from the music boundary's track rows); deterministic triggers
   * leave it undefined and `buildContext` derives it from the schedule.
   */
  private launch(
    candidate: TriggerCandidate,
    now: Date,
    context?: MomentContext,
  ): void {
    this.inFlight.add(candidate.dedupeKey);
    if (candidate.priority >= PRIORITY.hour_open) {
      this.lastDeterministicFireAt = candidate.fireAt;
    }

    const entry: PendingMoment = {
      key: candidate.dedupeKey,
      triggerType: candidate.triggerType,
      fireAt: candidate.fireAt,
      chainId: candidate.chainId,
      chainIndex: candidate.chainIndex,
      state: "generating",
    };
    this.pending.push(entry);

    const task = (async () => {
      const resolved = context ?? (await this.buildContext(candidate));
      if (resolved === null) {
        // Nothing to say (e.g. no news rows) — drop the moment rather than
        // invent content; the personas are under orders not to make facts up.
        console.warn(
          `[scheduler] skipping ${candidate.triggerType} at ` +
            `${candidate.fireAt.toISOString()} — no source data`,
        );
        entry.state = "failed";
        return;
      }

      const plan: MomentPlan = {
        triggerType: candidate.triggerType,
        presenter: candidate.active.presenter,
        scheduleSlotId: candidate.active.slot.id,
        // Stamped once here rather than in each context builder.
        context: { ...resolved, fireAt: candidate.fireAt.toISOString() },
      };
      const result = await this.generate(plan);
      entry.clipId = result.clipId;
      entry.scriptText = result.scriptText;
      if (result.status === "ready") {
        entry.state = "ready";
        entry.audioPath = result.audioPath;
        entry.durationSeconds = result.durationSeconds ?? null;
      } else {
        entry.state = "failed";
      }
    })()
      .catch((err: unknown) => {
        console.error(
          `[scheduler] generation of ${candidate.triggerType} crashed —`,
          err,
        );
        entry.state = "failed";
      })
      .finally(() => {
        this.inFlight.delete(candidate.dedupeKey);
        this.tasks.delete(task);
      });

    this.tasks.add(task);
    console.log(
      `[scheduler] generating ${candidate.triggerType} for ` +
        `${candidate.fireAt.toISOString()} (${candidate.active.presenter.name}), ` +
        `${Math.round((candidate.fireAt.getTime() - now.getTime()) / 1000)}s ahead`,
    );
  }

  /** Fills in the moment's prompt context, hitting the news/weather providers
   *  where the template needs raw source data. */
  private async buildContext(
    candidate: TriggerCandidate,
  ): Promise<MomentContext | null> {
    const currentTime = formatStationTime(candidate.fireAt);
    const dedupeKey = candidate.dedupeKey;
    const { collection } = candidate.active;

    switch (candidate.triggerType) {
      case "changeover":
        return {
          triggerType: "changeover",
          currentTime,
          dedupeKey,
          oldPlaylistName: candidate.outgoingCollectionName ?? "the last hour",
          newPlaylistName: collection.name,
          moodTag: collection.mood_tag,
        };
      case "hour_open":
        return {
          triggerType: "hour_open",
          currentTime,
          dedupeKey,
          playlistName: collection.name,
        };
      case "news": {
        const items = await this.news.fetchLatestNews(config.newsItemCount);
        if (items.length === 0) return null;
        return { triggerType: "news", currentTime, dedupeKey, items };
      }
      case "weather": {
        const reading = await this.weather.fetchCurrent();
        if (reading === null) return null;
        return { triggerType: "weather", currentTime, dedupeKey, reading };
      }
      case "sign_off":
        return {
          triggerType: "sign_off",
          currentTime,
          dedupeKey,
          playlistName: collection.name,
        };
      default:
        // song_intro and filler come from onMusicBoundary, which builds their
        // context from the boundary's tracks rather than from a candidate.
        return null;
    }
  }

  // --- probabilistic triggers (music boundaries) ---------------------------

  /**
   * Called by MusicDirector every time a track is handed to LiquidSoap. The
   * boundary being rolled for is the END of that track, so there is a whole
   * track's playtime to generate in before the clip has to be pushed.
   */
  private onMusicBoundary(event: BoundaryEvent): void {
    const now = this.clock();
    const snapshot = loadScheduleSnapshot();

    const decision = rollProbabilistic({
      boundaryAt: event.at,
      deterministicNear: this.deterministicNear(snapshot, now, event.at),
      hasUpcomingTrack: event.upcomingTrack !== undefined,
      lastProbabilisticAt: this.lastProbabilisticAt,
      random: this.random,
    });
    if (decision === null) return;

    const dedupeKey = `${decision}:${event.at.toISOString()}`;
    if (this.isKnown(dedupeKey)) return;
    this.lastProbabilisticAt = event.at;

    const { collection } = event.active;
    const currentTime = formatStationTime(event.at);
    const context: MomentContext =
      decision === "song_intro"
        ? {
            triggerType: "song_intro",
            currentTime,
            dedupeKey,
            playlistName: collection.name,
            lastSongTitle: event.endingTrack.title,
            lastArtist: event.endingTrack.artist,
            nextSongTitle: event.upcomingTrack?.title ?? null,
            nextArtist: event.upcomingTrack?.artist ?? null,
            moodTag: collection.mood_tag,
          }
        : {
            triggerType: "filler",
            currentTime,
            dedupeKey,
            playlistName: collection.name,
          };

    this.launch(
      {
        triggerType: decision,
        dedupeKey,
        fireAt: event.at,
        priority: PRIORITY[decision],
        active: event.active,
        chainIndex: 0,
      },
      now,
      context,
    );
  }

  /** True if a deterministic trigger airs within the stack guard of `at`. */
  private deterministicNear(
    snapshot: ScheduleSnapshot,
    now: Date,
    at: Date,
  ): boolean {
    const guardMs = config.stackGuardSeconds * 1000;

    if (
      this.lastDeterministicFireAt !== undefined &&
      Math.abs(this.lastDeterministicFireAt.getTime() - at.getTime()) < guardMs
    ) {
      return true;
    }
    if (
      this.pending.some(
        (p) =>
          PRIORITY[p.triggerType] >= PRIORITY.hour_open &&
          Math.abs(p.fireAt.getTime() - at.getTime()) < guardMs,
      )
    ) {
      return true;
    }

    // The boundary can be further out than the normal lookahead (a long
    // track), so look as far as the boundary plus the guard.
    const horizonMs = Math.max(
      config.lookaheadSeconds * 1000,
      at.getTime() - now.getTime() + guardMs,
    );
    return collectDeterministic(snapshot, now, horizonMs).some(
      (c) => Math.abs(c.fireAt.getTime() - at.getTime()) < guardMs,
    );
  }

  // --- delivery -------------------------------------------------------------

  /** Pushes every clip that is ready and due, in chain order. */
  private async deliverDue(now: Date): Promise<TriggerType[]> {
    const leadMs = config.deliverLeadSeconds * 1000;
    const delivered: TriggerType[] = [];

    const due = this.pending
      .filter((p) => p.state === "ready")
      .filter((p) => now.getTime() >= p.fireAt.getTime() - leadMs)
      .filter((p) => this.chainReady(p))
      .sort(
        (a, b) =>
          a.fireAt.getTime() - b.fireAt.getTime() || a.chainIndex - b.chainIndex,
      );

    // A whole chain can be pushed in one tick (the triad is three clips). The
    // inject queue plays them in order, so `station_state` should name the FIRST
    // one as what's on air and hold that for the chain's combined length —
    // otherwise the live page would claim the weather is playing while the hour
    // marker is still being read.
    let airingHead: PendingMoment | undefined;
    let airingSeconds = 0;

    for (const moment of due) {
      const requestId = await this.deliver(moment.clipId!, moment.audioPath!);
      if (requestId === null) continue; // stays 'ready'; dropStale gives up later
      moment.state = "aired";
      delivered.push(moment.triggerType);
      airingHead ??= moment;
      airingSeconds += moment.durationSeconds ?? 12;
    }

    if (airingHead !== undefined) {
      this.airing = {
        triggerType: airingHead.triggerType,
        scriptText: airingHead.scriptText ?? "",
        startedAt: now,
        durationSeconds: airingHead.durationSeconds ?? null,
        until: new Date(now.getTime() + (airingSeconds + 3) * 1000),
      };
    }

    this.pending = this.pending.filter((p) => p.state !== "aired");
    return delivered;
  }

  /** Earlier members of the same chain must have aired (or given up) first, so
   *  the hour triad goes out as open -> news -> weather and never out of order. */
  private chainReady(moment: PendingMoment): boolean {
    if (moment.chainId === undefined) return true;
    return !this.pending.some(
      (p) =>
        p.chainId === moment.chainId &&
        p.chainIndex < moment.chainIndex &&
        (p.state === "generating" || p.state === "ready"),
    );
  }

  /**
   * Gives up on moments that can no longer air in context: a clip whose fire
   * time is further past than the grace window. Failed ones are dropped too.
   * A clip abandoned at 'ready' keeps that status in the DB on purpose — the
   * row then reads "generated fine, never aired", which is the distinction the
   * status lifecycle exists for.
   */
  private dropStale(now: Date): void {
    const graceMs = config.deliverGraceSeconds * 1000;
    const keep: PendingMoment[] = [];
    for (const moment of this.pending) {
      if (moment.state === "failed") continue;
      if (now.getTime() > moment.fireAt.getTime() + graceMs) {
        if (moment.state === "ready") {
          console.warn(
            `[scheduler] abandoning ${moment.triggerType} clip ${moment.clipId} — ` +
              `${Math.round((now.getTime() - moment.fireAt.getTime()) / 1000)}s late`,
          );
        }
        continue;
      }
      keep.push(moment);
    }
    this.pending = keep;
  }

  // --- station_state --------------------------------------------------------

  private writeState(active: ActiveSlot, now: Date): void {
    if (this.airing !== undefined && now.getTime() >= this.airing.until.getTime()) {
      this.airing = undefined;
    }

    const served = this.music.current();
    const upNextMoment = this.pending
      .filter((p) => p.state === "generating" || p.state === "ready")
      .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())[0];
    const upNextTrack = this.music.upNext();

    const speech = this.airing;
    writeStationState({
      current_item_type: speech ? "speech" : served ? "music" : null,
      current_item_ref: speech
        ? `${speech.triggerType}: ${truncate(speech.scriptText, 160)}`
        : (served?.track.title ?? null),
      current_item_started_at: speech
        ? speech.startedAt.toISOString()
        : (served?.startedAt.toISOString() ?? null),
      current_item_duration: speech
        ? speech.durationSeconds
        : (served?.durationSeconds ?? null),
      up_next_item_type: upNextMoment ? "speech" : upNextTrack ? "music" : null,
      up_next_item_ref: upNextMoment
        ? `${upNextMoment.triggerType} @ ${formatStationTime(upNextMoment.fireAt)}`
        : (upNextTrack?.title ?? null),
      current_presenter_id: active.presenter.id,
      current_collection_id: active.collection.id,
      current_schedule_slot_id: active.slot.id,
    });
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
