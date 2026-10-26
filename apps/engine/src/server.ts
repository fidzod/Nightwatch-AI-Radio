// The engine's HTTP surface. Uses node:http directly — there are two real
// routes plus a manual trigger hook, so a framework would be a dependency
// without a job.
//
// Routes
//   GET  /health            liveness, scheduler settings, who is on air now
//   GET  /next-music        LiquidSoap's `request.dynamic` pull side (see below)
//   GET  /schedule/now      what the scheduler resolves for a given instant
//                           (?at=ISO) — the quickest way to debug a schedule edit
//   GET|POST /trigger/<type>  fire one moment on demand (any of the seven)
//   GET|POST /speak         say literal ?text=... live, no Claude involved
//
// `/trigger/<type>` accepts:
//   ?deliver=false    stop once the clip is 'ready' (no LiquidSoap push) —
//                     what to use when iterating on prompt wording
//   ?presenter=Thaddeus  speak as a specific presenter (id or name)
//   ?collection=...   pretend a specific collection is playing
//
// `/speak` accepts:
//   ?text=...         required, the exact words to say (not run through Claude)
//   ?presenter=Thaddeus  speak as a specific presenter (id or name); defaults
//                     to whoever's on air now

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.ts";
import { ManualTriggerError, buildManualPlan, speakCustomMessage } from "./manual.ts";
import { runMoment } from "./moment.ts";
import { countryInfoFor } from "./providers/countryData.ts";
import { GoogleNewsRssProvider } from "./providers/googleNewsRssProvider.ts";
import { OpenMeteoWeatherProvider } from "./providers/openMeteoWeatherProvider.ts";
import { seedMockNewsAndWeather } from "./providers/seedMockData.ts";
import { Scheduler } from "./scheduler/loop.ts";
import { resolveActiveSlot } from "./scheduler/resolveActiveSlot.ts";
import { isTriggerType } from "./scheduler/types.ts";
import {
  closeDb,
  countRows,
  getCountry,
  loadScheduleSnapshot,
  seedCollectionFromDisk,
} from "./store.ts";

/**
 * Response shape for GET /next-music, consumed by `next_music()` in
 * liquidsoap/radio.liq:
 *
 *   { "uri": "/abs/path/to/track.mp3", "track_id": 3, "title": "test-track-3" }
 *
 * `uri` is the only field LiquidSoap reads (it feeds `request.create`), and it
 * is always an absolute path so LiquidSoap's working directory is irrelevant.
 * The other fields are informational. The field is named `uri` rather than
 * `path` because `path` shadows LiquidSoap's stdlib `path` module at the
 * destructuring site.
 */
interface NextMusicResponse {
  uri: string;
  track_id: number;
  title: string | null;
  collection: string;
  presenter: string;
}

/**
 * Real news/weather, wired in explicitly here rather than left to
 * `Scheduler`'s own constructor default — that default stays `MockNewsProvider`
 * / `MockWeatherProvider` on purpose (see loop.ts), because
 * src/test/simulateDay.ts constructs a `Scheduler` without passing providers
 * and must never make a live network call. This is the one place that stands
 * up the real providers for the actual running station.
 *
 * Both read the country via `getCountry()` on every call rather than once at
 * boot, so a `/settings` change takes effect on the provider's next fetch —
 * no engine restart required.
 */
const scheduler = new Scheduler({
  news: new GoogleNewsRssProvider(
    () => countryInfoFor(getCountry()).language,
    () => getCountry(),
  ),
  weather: new OpenMeteoWeatherProvider(() => getCountry()),
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

/**
 * Hands LiquidSoap a track from whatever collection the schedule says is on
 * air right now. Two distinct non-200 cases, both of which `next_music()`
 * handles by returning `null` (request.dynamic retries, `mksafe` plays
 * silence):
 *   503 off air   — no schedule slot covers now; the station is meant to be quiet
 *   503 no tracks — a slot is active but its collection is empty
 */
function handleNextMusic(res: ServerResponse): void {
  const served = scheduler.takeNextTrack();

  if (served === null) {
    const snapshot = loadScheduleSnapshot();
    const active = resolveActiveSlot(snapshot, new Date());
    sendJson(res, 503, {
      error: active === null ? "off air" : "no tracks available",
      detail:
        active === null
          ? "No enabled schedule slot covers the current time — the station is off air."
          : `Collection "${active.collection.name}" has no tracks. Upload mp3s on the web UI's Collections page.`,
    });
    return;
  }

  const body: NextMusicResponse = {
    uri: served.track.file_path,
    track_id: served.track.id,
    title: served.track.title,
    collection: served.active.collection.name,
    presenter: served.active.presenter.name,
  };
  console.log(
    `[next-music] -> ${body.uri} (${body.collection}, ${served.track.duration_seconds ?? "?"}s)`,
  );
  sendJson(res, 200, body);
}

async function handleTrigger(
  triggerType: string,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!isTriggerType(triggerType)) {
    sendJson(res, 404, {
      error: `unknown trigger type "${triggerType}"`,
      valid: [
        "song_intro",
        "changeover",
        "hour_open",
        "news",
        "weather",
        "sign_off",
        "filler",
      ],
    });
    return;
  }

  try {
    const plan = await buildManualPlan({
      triggerType,
      presenterRef: url.searchParams.get("presenter"),
      collectionRef: url.searchParams.get("collection"),
    });
    const result = await runMoment(plan, {
      deliver: url.searchParams.get("deliver") !== "false",
    });
    // 'failed' is a real outcome, not a server bug — report it as 502 so a test
    // script's exit code reflects it, but keep the body machine-readable.
    sendJson(res, result.status === "failed" ? 502 : 200, result);
  } catch (err) {
    if (err instanceof ManualTriggerError) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    throw err;
  }
}

async function handleSpeak(url: URL, res: ServerResponse): Promise<void> {
  const text = url.searchParams.get("text");
  if (text === null) {
    sendJson(res, 400, { error: "?text= is required." });
    return;
  }

  try {
    const result = await speakCustomMessage({
      text,
      presenterRef: url.searchParams.get("presenter"),
    });
    sendJson(res, result.status === "failed" ? 502 : 200, result);
  } catch (err) {
    if (err instanceof ManualTriggerError) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    throw err;
  }
}

function handleScheduleNow(url: URL, res: ServerResponse): void {
  const atParam = url.searchParams.get("at");
  const at = atParam ? new Date(atParam) : new Date();
  if (Number.isNaN(at.getTime())) {
    sendJson(res, 400, { error: `could not parse ?at=${atParam}` });
    return;
  }

  const active = resolveActiveSlot(loadScheduleSnapshot(), at);
  sendJson(res, 200, {
    at: at.toISOString(),
    on_air: active !== null,
    presenter: active?.presenter.name ?? null,
    collection: active?.collection.name ?? null,
    slot_id: active?.slot.id ?? null,
    slot_starts_at: active?.startsAt.toISOString() ?? null,
    slot_ends_at: active?.endsAt.toISOString() ?? null,
  });
}

const server = createServer(
  (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      const active = resolveActiveSlot(loadScheduleSnapshot(), new Date());
      sendJson(res, 200, {
        ok: true,
        on_air: active !== null,
        presenter: active?.presenter.name ?? null,
        collection: active?.collection.name ?? null,
        scheduler_enabled: config.schedulerEnabled,
        tick_seconds: config.tickSeconds,
        lookahead_seconds: config.lookaheadSeconds,
        song_intro_probability: config.songIntroProbability,
        filler_probability: config.fillerProbability,
        claude_model: config.claudeModel,
        elevenlabs_model: config.elevenLabsModel,
        // Reported so a caller can tell "AI disabled" from "AI broken"
        // without the keys ever being echoed.
        anthropic_key_present: Boolean(process.env.ANTHROPIC_API_KEY),
        elevenlabs_key_present: Boolean(process.env.ELEVENLABS_API_KEY),
      });
      return;
    }

    if (url.pathname === "/next-music" && req.method === "GET") {
      handleNextMusic(res);
      return;
    }

    if (url.pathname === "/schedule/now" && req.method === "GET") {
      handleScheduleNow(url, res);
      return;
    }

    const trigger = /^\/trigger\/([a-z_]+)$/.exec(url.pathname);
    if (trigger && (req.method === "POST" || req.method === "GET")) {
      handleTrigger(trigger[1]!, url, res).catch((err: unknown) => {
        console.error(`[server] ${url.pathname} crashed —`, err);
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    if (url.pathname === "/speak" && (req.method === "POST" || req.method === "GET")) {
      handleSpeak(url, res).catch((err: unknown) => {
        console.error(`[server] ${url.pathname} crashed —`, err);
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    sendJson(res, 404, { error: "not found", path: url.pathname });
  },
);

// --- boot -------------------------------------------------------------------
// Bootstrap seeding only: mock news/weather rows if those tables are empty, and
// the Phase 1 test collection only if the user has no collections at all (so a
// fresh clone has something to play, and an established station is never
// handed back a collection it deleted).
seedMockNewsAndWeather();
if (countRows("collections") === 0) {
  seedCollectionFromDisk(config.testCollectionName);
}

server.listen(config.httpPort, "127.0.0.1", () => {
  console.log(
    `[server] engine listening on http://127.0.0.1:${config.httpPort}`,
  );
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ELEVENLABS_API_KEY) {
    console.warn(
      "[server] ANTHROPIC_API_KEY and/or ELEVENLABS_API_KEY not set — " +
        "music playback works, but every generated clip will report 'failed'. " +
        "Copy .env.example to .env at the repo root to enable AI generation.",
    );
  }
  if (config.schedulerEnabled) scheduler.start();
  else console.warn("[server] SCHEDULER_ENABLED=0 — music only, no AI moments");
});

let fillerTimer: NodeJS.Timeout | undefined;
if (config.fillerIntervalSeconds > 0) {
  console.log(
    `[server] firing a filler clip every ${config.fillerIntervalSeconds}s ` +
      `(FILLER_INTERVAL_SECONDS)`,
  );
  fillerTimer = setInterval(() => {
    void (async () => {
      try {
        await runMoment(await buildManualPlan({ triggerType: "filler" }));
      } catch (err) {
        console.error("[server] interval filler failed —", err);
      }
    })();
  }, config.fillerIntervalSeconds * 1_000);
}

function shutdown(signal: string): void {
  console.log(`[server] ${signal} — shutting down`);
  if (fillerTimer) clearInterval(fillerTimer);
  scheduler.stop();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Don't hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
