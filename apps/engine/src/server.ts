// The engine's HTTP surface. Uses node:http directly — there is one real
// route plus two test hooks, so a framework would be a dependency without a job.
//
// Routes
//   GET  /health         liveness + whether AI generation is configured
//   GET  /next-music     LiquidSoap's `request.dynamic` pull side (see below)
//   POST /trigger/filler force one filler one-liner end-to-end (Phase 2 proof)
//   GET  /trigger/filler same, so it can be fired from a browser/curl with no -X
//
// `/trigger/filler` accepts `?deliver=false` to stop after the clip is 'ready'
// (generation only, no LiquidSoap push) — useful when testing without
// liquidsoap running.
//
// Phase 3 replaces the optional FILLER_INTERVAL_SECONDS timer below with the
// real ~5s scheduler loop and the full trigger-rule matrix.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.ts";
import { runFillerOnce } from "./filler.ts";
import {
  closeDb,
  markTrackPlayed,
  pickNextTrack,
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
 * The other fields are informational — they make `curl /next-music` readable
 * and give Phase 3's `station_state` writer something to key on. The field is
 * named `uri` rather than `path` because `path` shadows LiquidSoap's stdlib
 * `path` module at the destructuring site.
 */
interface NextMusicResponse {
  uri: string;
  track_id: number;
  title: string | null;
}

/** The track handed out most recently, so the next pick can't repeat it. */
let lastTrackId: number | undefined;

let collectionId: number;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function handleNextMusic(res: ServerResponse): void {
  const track = pickNextTrack(collectionId, lastTrackId);

  if (track === undefined) {
    // 503 rather than 200-with-null: `next_music()` in radio.liq checks
    // status_code and returns `null`, so request.dynamic retries on its
    // retry_delay instead of treating a missing track as a hard failure.
    sendJson(res, 503, {
      error: "no tracks available",
      collection: config.testCollectionName,
      hint: `Put .mp3 files in ${config.libraryDir}/${config.testCollectionName}/ and restart the engine.`,
    });
    return;
  }

  lastTrackId = track.id;
  markTrackPlayed(track.id);

  const body: NextMusicResponse = {
    uri: track.file_path,
    track_id: track.id,
    title: track.title,
  };
  console.log(`[next-music] -> ${body.uri}`);
  sendJson(res, 200, body);
}

async function handleTriggerFiller(
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const deliver = url.searchParams.get("deliver") !== "false";
  const result = await runFillerOnce({ deliver });
  // 'failed' is a real outcome, not a server bug — report it as 502 so a test
  // script's exit code reflects it, but keep the body machine-readable.
  sendJson(res, result.status === "failed" ? 502 : 200, result);
}

const server = createServer(
  (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        collection: config.testCollectionName,
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

    if (
      url.pathname === "/trigger/filler" &&
      (req.method === "POST" || req.method === "GET")
    ) {
      handleTriggerFiller(url, res).catch((err: unknown) => {
        console.error("[server] /trigger/filler crashed —", err);
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    sendJson(res, 404, { error: "not found", path: url.pathname });
  },
);

// Seed before listening, so the first /next-music can never race the seed.
collectionId = seedCollectionFromDisk(config.testCollectionName);

server.listen(config.httpPort, "127.0.0.1", () => {
  console.log(
    `[server] engine listening on http://127.0.0.1:${config.httpPort} ` +
      `(collection "${config.testCollectionName}", id ${collectionId})`,
  );
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ELEVENLABS_API_KEY) {
    console.warn(
      "[server] ANTHROPIC_API_KEY and/or ELEVENLABS_API_KEY not set — " +
        "music playback works, but /trigger/filler will report 'failed'. " +
        "Copy .env.example to .env at the repo root to enable AI generation.",
    );
  }
});

let fillerTimer: NodeJS.Timeout | undefined;
if (config.fillerIntervalSeconds > 0) {
  console.log(
    `[server] firing a filler clip every ${config.fillerIntervalSeconds}s ` +
      `(FILLER_INTERVAL_SECONDS)`,
  );
  fillerTimer = setInterval(() => {
    void runFillerOnce();
  }, config.fillerIntervalSeconds * 1_000);
}

function shutdown(signal: string): void {
  console.log(`[server] ${signal} — shutting down`);
  if (fillerTimer) clearInterval(fillerTimer);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Don't hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
