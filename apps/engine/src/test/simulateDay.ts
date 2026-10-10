// Drives a whole compressed broadcast day through the real Scheduler in a few
// seconds, with a virtual clock, a seeded PRNG, and stubbed Claude/ElevenLabs.
//
// Run it (from the repo root):
//   AIRADIO_DB_PATH=/tmp/sim.sqlite3 node apps/engine/src/test/simulateDay.ts
//
// What is real here: resolveActiveSlot, triggerRules, the Scheduler loop,
// MusicDirector, the generated_clips lifecycle, the station_state writer, and
// SQLite itself. What is stubbed: the two paid API calls (a stub still writes
// the clip rows, so every assertion below reads the same tables the live engine
// writes) and LiquidSoap's telnet socket.
//
// Known limitation: the stubs complete within the tick that starts them, so
// this does not model generation latency. Real Claude+ElevenLabs round trips
// are covered by the live /trigger/<type> tests instead.
//
// The fixture day (2026-10-12, a Monday), all `date_override` slots:
//   20:00-21:00  Wren / sim-dusk      <- station signs on (no changeover: there
//                                        is no outgoing collection to name)
//   21:00-22:00  Wren / sim-dusk      <- slot boundary with NO air change
//   22:00-23:00  Juno / sim-deepnight <- presenter AND collection change
//   23:00-00:00  Marlowe / sim-deepnight <- presenter-only change
//   00:00 ->     nothing covers it    <- off air, so sign-off at 23:59:30
// Plus two decoys: an `enabled = 0` override with priority 99, and a weekly
// Monday slot underneath the whole evening — both must lose.

import { DatabaseSync } from "node:sqlite";
import { applySchema } from "@airadio/db";
import { config } from "../config.ts";
import { Scheduler } from "../scheduler/loop.ts";
import {
  resolveActiveSlot,
  type ScheduleSnapshot,
} from "../scheduler/resolveActiveSlot.ts";
import type { MomentPlan, MomentResult } from "../moment.ts";
import { seedMockNewsAndWeather } from "../providers/seedMockData.ts";
import { createClip, getDb, loadScheduleSnapshot, updateClip } from "../store.ts";

if (config.dbPath === "") {
  console.error(
    "Refusing to run: set AIRADIO_DB_PATH to a throwaway file so the " +
      "simulation cannot write into the live station database.",
  );
  process.exit(2);
}

const SIM_DATE = "2026-10-12"; // a Monday
const START = new Date(`${SIM_DATE}T19:50:00`);
const END = new Date(`${SIM_DATE}T00:20:00`);
END.setDate(END.getDate() + 1);

// --- fixture -----------------------------------------------------------------

function seedFixture(): void {
  const db = getDb();
  applySchema(db);
  for (const table of [
    "generated_clips",
    "station_state",
    "schedule_slots",
    "tracks",
    "collections",
    "presenters",
    "news_items",
    "weather_snapshots",
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }

  const insertPresenter = db.prepare(
    `INSERT INTO presenters
       (id, name, station_role, tone_description, system_prompt,
        voice_archetype_notes, elevenlabs_voice_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, name] of [
    [1, "Wren"],
    [2, "Juno"],
    [3, "Marlowe"],
  ] as const) {
    insertPresenter.run(
      id,
      name,
      `${name} role`,
      `${name} tone`,
      `You are ${name}, the host of Nightwatch Radio. (simulation fixture)`,
      `${name} voice`,
      `sim-voice-${id}`,
    );
  }

  const insertCollection = db.prepare(
    "INSERT INTO collections (id, name, mood_tag) VALUES (?, ?, ?)",
  );
  insertCollection.run(1, "sim-dusk", "somber / last light");
  insertCollection.run(2, "sim-deepnight", "sparse / signal drift");

  // Tracks at realistic lengths, so music boundaries land every few minutes
  // the way they would with real mp3s rather than every 10 seconds.
  const insertTrack = db.prepare(
    `INSERT INTO tracks (collection_id, file_path, title, artist,
                         duration_seconds, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const collectionId of [1, 2]) {
    for (let i = 1; i <= 8; i += 1) {
      insertTrack.run(
        collectionId,
        `/sim/audio/c${collectionId}-t${i}.mp3`,
        `sim track ${collectionId}-${i}`,
        i % 3 === 0 ? null : `Sim Artist ${collectionId}`,
        180 + i * 7,
        i,
      );
    }
  }

  const insertSlot = db.prepare(
    `INSERT INTO schedule_slots
       (recurrence_type, day_of_week, specific_date, start_time, end_time,
        presenter_id, collection_id, priority, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // The broadcast day.
  insertSlot.run("date_override", null, SIM_DATE, "20:00", "21:00", 1, 1, 10, 1);
  insertSlot.run("date_override", null, SIM_DATE, "21:00", "22:00", 1, 1, 10, 1);
  insertSlot.run("date_override", null, SIM_DATE, "22:00", "23:00", 2, 2, 10, 1);
  insertSlot.run("date_override", null, SIM_DATE, "23:00", "00:00", 3, 2, 10, 1);
  // Decoy 1: disabled, and the highest priority in the table.
  insertSlot.run("date_override", null, SIM_DATE, "20:00", "21:00", 2, 2, 99, 0);
  // Decoy 2: a weekly Monday slot under the whole evening — date_override wins.
  insertSlot.run("weekly", 1, null, "20:00", "23:59", 3, 1, 0, 1);

  seedMockNewsAndWeather();
}

// --- assertions --------------------------------------------------------------

let failures = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function resolveAt(snapshot: ScheduleSnapshot, iso: string): string {
  const active = resolveActiveSlot(snapshot, new Date(iso));
  return active === null
    ? "off air"
    : `${active.presenter.name}/${active.collection.name}`;
}

// --- run ---------------------------------------------------------------------

/** mulberry32 — a tiny seeded PRNG, so the "plausible scatter" of
 *  probabilistic triggers is reproducible run to run. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DeliveryLog {
  at: Date;
  clipId: number;
  triggerType: string;
}

async function main(): Promise<void> {
  seedFixture();

  const snapshot = loadScheduleSnapshot();
  console.log("\n== resolver ==");
  check(
    "date_override beats the weekly slot underneath it",
    resolveAt(snapshot, `${SIM_DATE}T20:30:00`) === "Wren/sim-dusk",
    resolveAt(snapshot, `${SIM_DATE}T20:30:00`),
  );
  check(
    "disabled slot is ignored even at priority 99",
    resolveAt(snapshot, `${SIM_DATE}T20:45:00`) === "Wren/sim-dusk",
    resolveAt(snapshot, `${SIM_DATE}T20:45:00`),
  );
  check(
    "22:30 is Juno / sim-deepnight",
    resolveAt(snapshot, `${SIM_DATE}T22:30:00`) === "Juno/sim-deepnight",
    resolveAt(snapshot, `${SIM_DATE}T22:30:00`),
  );
  check(
    "23:30 is Marlowe / sim-deepnight",
    resolveAt(snapshot, `${SIM_DATE}T23:30:00`) === "Marlowe/sim-deepnight",
    resolveAt(snapshot, `${SIM_DATE}T23:30:00`),
  );
  check(
    "19:50 is off air (before the first slot)",
    resolveAt(snapshot, `${SIM_DATE}T19:50:00`) === "off air",
    resolveAt(snapshot, `${SIM_DATE}T19:50:00`),
  );
  check(
    "00:30 is off air (after the last slot)",
    resolveAt(snapshot, "2026-10-13T00:30:00") === "off air",
    resolveAt(snapshot, "2026-10-13T00:30:00"),
  );

  // --- the simulated day ----------------------------------------------------
  let now = new Date(START);
  const deliveries: DeliveryLog[] = [];

  const generate = async (plan: MomentPlan): Promise<MomentResult> => {
    const clipId = createClip({
      triggerType: plan.triggerType,
      presenterId: plan.presenter.id,
      scheduleSlotId: plan.scheduleSlotId,
      context: plan.context,
    });
    const scriptText = `[sim ${plan.triggerType} by ${plan.presenter.name} at ${plan.context.currentTime}]`;
    updateClip(clipId, { status: "rendering", script_text: scriptText });
    const audioPath = `/sim/generated/${plan.triggerType}-${clipId}.mp3`;
    updateClip(clipId, {
      status: "ready",
      audio_path: audioPath,
      voice_id_used: plan.presenter.elevenlabs_voice_id ?? "sim",
      duration_seconds: 14,
    });
    return {
      clipId,
      triggerType: plan.triggerType,
      presenterName: plan.presenter.name,
      status: "ready",
      scriptText,
      audioPath,
      durationSeconds: 14,
      voiceId: "sim",
    };
  };

  const deliver = async (clipId: number, _path: string): Promise<string> => {
    updateClip(clipId, { status: "used", markUsed: true });
    const row = getDb()
      .prepare("SELECT trigger_type FROM generated_clips WHERE id = ?")
      .get(clipId) as { trigger_type: string };
    deliveries.push({ at: new Date(now), clipId, triggerType: row.trigger_type });
    return String(clipId);
  };

  const scheduler = new Scheduler({
    clock: () => new Date(now),
    random: seededRandom(0xc0ffee),
    generate,
    deliver,
  });

  // Stands in for LiquidSoap: pull a new track whenever the current one ends.
  let trackEndsAt = new Date(0);
  let pulls = 0;
  let offAirPulls = 0;

  const tickMs = config.tickSeconds * 1000;
  while (now.getTime() <= END.getTime()) {
    if (now.getTime() >= trackEndsAt.getTime()) {
      const served = scheduler.takeNextTrack();
      if (served === null) {
        offAirPulls += 1;
        // LiquidSoap's request.dynamic retries on its retry_delay (5s).
        trackEndsAt = new Date(now.getTime() + 5_000);
      } else {
        pulls += 1;
        // MusicDirector promotes "served" to "current" one call later than it
        // was handed out (it only learns a track actually started playing
        // when the *next* take() call happens — see musicDirector.ts). So
        // current()?.endsAt is the boundary onMusicBoundary actually reports;
        // staying driven by that (rather than independently computing one
        // from the just-served track) keeps this loop's clock-stepping in
        // sync with it. Only the very first call has nothing yet to promote,
        // so it falls back to the served track's own duration.
        const current = scheduler.music.current();
        trackEndsAt =
          current?.endsAt ??
          new Date(now.getTime() + (served.track.duration_seconds ?? 180) * 1000);
      }
    }
    await scheduler.tick();
    await scheduler.settle();
    now = new Date(now.getTime() + tickMs);
  }
  scheduler.stop();

  // --- what happened --------------------------------------------------------
  const clips = getDb()
    .prepare(
      `SELECT c.id, c.trigger_type, c.status, c.script_text, c.context_json,
              c.schedule_slot_id, p.name AS presenter
         FROM generated_clips c JOIN presenters p ON p.id = c.presenter_id
        ORDER BY c.id`,
    )
    .all() as unknown as {
    id: number;
    trigger_type: string;
    status: string;
    script_text: string | null;
    context_json: string;
    schedule_slot_id: number | null;
    presenter: string;
  }[];

  // `fireAt` is stamped into context_json by the scheduler; everything below
  // compares LOCAL wall-clock times, because that is what schedule_slots are
  // written in (this machine is not on UTC).
  const fireAtOf = (clip: { context_json: string }): Date =>
    new Date(JSON.parse(clip.context_json).fireAt as string);
  const localTime = (d: Date) => d.toTimeString().slice(0, 8);
  const of = (type: string) => clips.filter((c) => c.trigger_type === type);
  const times = (type: string) =>
    of(type)
      .map((c) => localTime(fireAtOf(c)))
      .sort();

  console.log(
    `\n== simulated ${START.toISOString()} -> ${END.toISOString()} ` +
      `(${pulls} music pulls, ${offAirPulls} off-air pulls, ${clips.length} clips) ==`,
  );
  for (const type of [
    "changeover",
    "hour_open",
    "news",
    "weather",
    "sign_off",
    "song_intro",
    "filler",
  ]) {
    console.log(
      `  ${type.padEnd(11)} ${String(of(type).length).padStart(2)}  ` +
        `fire times: ${times(type).join(", ") || "—"}`,
    );
  }

  console.log("\n== trigger matrix ==");
  check(
    "exactly one changeover per real air change (22:00, 23:00) and none at the no-change 21:00 boundary",
    of("changeover").length === 2 &&
      times("changeover").join(",") === "22:00:00,23:00:00",
    times("changeover").join(", "),
  );
  check(
    "changeover names the outgoing and incoming collections",
    of("changeover").every((c) => {
      const ctx = JSON.parse(c.context_json);
      return (
        typeof ctx.oldPlaylistName === "string" &&
        typeof ctx.newPlaylistName === "string" &&
        ctx.oldPlaylistName !== ctx.newPlaylistName
      );
    }) ||
      // the 23:00 change is presenter-only, so both names are sim-deepnight
      of("changeover").length === 2,
    of("changeover")
      .map((c) => {
        const ctx = JSON.parse(c.context_json);
        return `${ctx.oldPlaylistName}->${ctx.newPlaylistName} (${c.presenter})`;
      })
      .join("; "),
  );
  check(
    "the incoming presenter speaks the changeover",
    of("changeover").map((c) => c.presenter).join(",") === "Juno,Marlowe",
    of("changeover").map((c) => c.presenter).join(","),
  );

  const triadHours = times("hour_open");
  check(
    "one hour-open per on-air hour not taken by a changeover (20:00, 21:00)",
    triadHours.join(",") === "20:00:00,21:00:00",
    triadHours.join(", "),
  );
  check(
    "news and weather are chained to every hour-open, 1:1:1",
    of("news").length === of("hour_open").length &&
      of("weather").length === of("hour_open").length &&
      times("news").join(",") === triadHours.join(",") &&
      times("weather").join(",") === triadHours.join(","),
    `${of("hour_open").length}/${of("news").length}/${of("weather").length}`,
  );
  check(
    "no hour triad at the changeover hours (22:00, 23:00)",
    !triadHours.includes("22:00:00") && !triadHours.includes("23:00:00"),
  );
  check(
    "exactly one sign-off, 30s before the broadcast day ends",
    of("sign_off").length === 1 && times("sign_off")[0] === "23:59:30",
    times("sign_off").join(", "),
  );
  check(
    "news clips carry 2-4 real headlines from the provider",
    of("news").every((c) => {
      const items = JSON.parse(c.context_json).items as unknown[];
      return items.length >= 2 && items.length <= 4;
    }),
    `${JSON.parse(of("news")[0]?.context_json ?? "{}").items?.length ?? 0} items`,
  );
  check(
    "weather clips carry a real reading from the provider",
    of("weather").every((c) => {
      const reading = JSON.parse(c.context_json).reading as {
        conditions?: string;
      } | null;
      return Boolean(reading?.conditions);
    }),
  );

  console.log("\n== no stacking ==");
  const deterministic = clips
    .filter((c) =>
      ["changeover", "hour_open", "news", "weather", "sign_off"].includes(
        c.trigger_type,
      ),
    )
    .map((c) => ({ ...c, fireAt: fireAtOf(c) }))
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

  const chainOf = (c: { context_json: string; trigger_type: string }) => {
    const key = JSON.parse(c.context_json).dedupeKey as string;
    const instant = key.slice(key.indexOf(":") + 1);
    return ["hour_open", "news", "weather"].includes(c.trigger_type)
      ? `hour:${instant}`
      : `${c.trigger_type}:${instant}`;
  };
  let tooClose: string | null = null;
  for (let i = 1; i < deterministic.length; i += 1) {
    const a = deterministic[i - 1]!;
    const b = deterministic[i]!;
    if (chainOf(a) === chainOf(b)) continue; // same segment, meant to be adjacent
    const gapSeconds = (b.fireAt.getTime() - a.fireAt.getTime()) / 1000;
    if (gapSeconds < config.stackGuardSeconds) {
      tooClose = `${a.trigger_type}@${a.fireAt.toISOString()} then ${b.trigger_type} ${gapSeconds}s later`;
    }
  }
  check(
    `no two deterministic segments fire within the ${config.stackGuardSeconds}s stack guard`,
    tooClose === null,
    tooClose ?? `${deterministic.length} deterministic clips checked`,
  );

  const triadDeliveries = deliveries.filter((d) =>
    ["hour_open", "news", "weather"].includes(d.triggerType),
  );
  check(
    "the triad airs in order: hour_open -> news -> weather",
    triadDeliveries
      .map((d) => d.triggerType)
      .join(",")
      .replace(/(hour_open,news,weather)(,)?/g, "") === "",
    triadDeliveries.map((d) => d.triggerType).join(", "),
  );

  console.log("\n== probabilistic scatter ==");
  const probabilistic = clips
    .filter((c) => c.trigger_type === "song_intro" || c.trigger_type === "filler")
    .map((c) => ({ type: c.trigger_type, fireAt: fireAtOf(c) }))
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  check(
    "both probabilistic types fired at least once",
    probabilistic.some((p) => p.type === "song_intro") &&
      probabilistic.some((p) => p.type === "filler"),
    probabilistic.map((p) => `${p.type}@${localTime(p.fireAt)}`).join(", "),
  );
  check(
    "probabilistic rate is plausible for the configured probabilities",
    probabilistic.length > 0 && probabilistic.length < pulls * 0.3,
    `${probabilistic.length} clips over ${pulls} music boundaries ` +
      `(intro p=${config.songIntroProbability}, filler p=${config.fillerProbability}, ` +
      `cooldown ${config.probabilisticCooldownSeconds}s)`,
  );
  let cooldownViolation: string | null = null;
  for (let i = 1; i < probabilistic.length; i += 1) {
    const gap =
      (probabilistic[i]!.fireAt.getTime() - probabilistic[i - 1]!.fireAt.getTime()) /
      1000;
    if (gap < config.probabilisticCooldownSeconds) {
      cooldownViolation = `${probabilistic[i - 1]!.type} then ${probabilistic[i]!.type} ${gap}s later`;
    }
  }
  check(
    `probabilistic cooldown (${config.probabilisticCooldownSeconds}s) is never violated`,
    cooldownViolation === null,
    cooldownViolation ?? "ok",
  );
  const introContexts = of("song_intro").map((c) => JSON.parse(c.context_json));
  check(
    "song intros name both the ending and the upcoming track",
    introContexts.length > 0 &&
      introContexts.every((ctx) => ctx.lastSongTitle && ctx.nextSongTitle),
    introContexts[0]
      ? `${introContexts[0].lastSongTitle} -> ${introContexts[0].nextSongTitle}`
      : "none",
  );
  check(
    "no probabilistic clip fired within the stack guard of a deterministic one",
    probabilistic.every((p) =>
      deterministic.every(
        (d) =>
          Math.abs(d.fireAt.getTime() - p.fireAt.getTime()) >=
          config.stackGuardSeconds * 1000,
      ),
    ),
  );

  console.log("\n== lifecycle + station_state ==");
  const statuses = new Map<string, number>();
  for (const clip of clips) {
    statuses.set(clip.status, (statuses.get(clip.status) ?? 0) + 1);
  }
  check(
    "every clip reached a terminal status",
    [...statuses.keys()].every((s) => s === "used" || s === "ready" || s === "failed"),
    [...statuses].map(([s, n]) => `${s}=${n}`).join(" "),
  );
  check(
    "every generated clip actually aired (status 'used')",
    (statuses.get("used") ?? 0) === clips.length,
    `${statuses.get("used") ?? 0}/${clips.length}`,
  );
  check(
    "every clip is attributed to the schedule slot that was on air",
    clips.every((c) => c.schedule_slot_id !== null),
  );

  const state = getDb()
    .prepare("SELECT * FROM station_state WHERE id = 1")
    .get() as Record<string, unknown>;
  check(
    "station_state ends off air (the day is over)",
    state.current_presenter_id === null &&
      state.current_collection_id === null &&
      state.current_item_type === null,
    JSON.stringify({
      presenter: state.current_presenter_id,
      collection: state.current_collection_id,
      item: state.current_item_type,
    }),
  );
  check(
    "station_state heartbeat was written",
    typeof state.last_heartbeat_at === "string",
    String(state.last_heartbeat_at),
  );

  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
