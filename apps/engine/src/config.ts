// Engine configuration: repo paths, ports, and secrets.
//
// Secrets come from the repo-root `.env` (gitignored, see `.env.example`).
// We deliberately avoid a `dotenv` dependency: `loadDotEnv()` below is a
// ~15-line parser, and `pnpm start` passes Node's own
// `--env-file-if-exists=../../.env` anyway. Either path works; whichever
// populates `process.env` first wins (real env vars always beat the file).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, derived from this file's location (apps/engine/src/config.ts). */
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Minimal `.env` reader. Only sets keys that aren't already defined, so a real
 * environment variable (or Node's `--env-file`) always takes precedence.
 * Silently does nothing if the file is absent — the engine must boot without
 * secrets so `/next-music` keeps serving music even when AI generation can't run.
 */
export function loadDotEnv(path = join(REPO_ROOT, ".env")): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, if present.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Thrown when an AI-generation secret is missing. Caught and logged as a clear,
 *  actionable message rather than crashing the engine. */
export class MissingConfigError extends Error {
  constructor(varName: string) {
    super(
      `${varName} is not set. Copy .env.example to .env at the repo root and ` +
        `fill it in (see the ".env" entry in .gitignore — it is never committed). ` +
        `Music playback via /next-music works without it; only AI clip ` +
        `generation is disabled.`,
    );
    this.name = "MissingConfigError";
  }
}

/** Reads a required secret, throwing a MissingConfigError with remediation steps. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new MissingConfigError(name);
  }
  return value;
}

export const config = {
  httpPort: intEnv("ENGINE_HTTP_PORT", 7777),
  liquidsoapTelnetHost: process.env.LIQUIDSOAP_TELNET_HOST ?? "127.0.0.1",
  liquidsoapTelnetPort: intEnv("LIQUIDSOAP_TELNET_PORT", 1234),

  /** Phase 2 uses a single hardcoded collection; Phase 3 resolves this from
   *  `schedule_slots`. */
  testCollectionName: "test-collection",
  libraryDir: join(REPO_ROOT, "audio", "library"),
  generatedDir: join(REPO_ROOT, "audio", "generated"),

  /** The plan's locked-in decision #5 is "Claude API (Sonnet family) for
   *  scripts", so Sonnet — not the general-purpose Opus default — is the
   *  intended model here. Overridable without a code change. */
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-5",

  /** ElevenLabs Flash — chosen in plan decision #5 for its low latency, which
   *  matters because clips are generated close to their delivery deadline. */
  elevenLabsModel: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
  /** Real voice selection per presenter is a later step (the plan leaves
   *  `presenters.elevenlabs_voice_id` nullable on purpose). This is a stock
   *  ElevenLabs library voice used only to prove the pipeline. */
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM",
  elevenLabsOutputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT ?? "mp3_44100_128",

  /** When > 0, the server fires a filler generation on this interval. Phase 2
   *  only — Phase 3 replaces it with the real trigger-rule scheduler loop. */
  fillerIntervalSeconds: intEnv("FILLER_INTERVAL_SECONDS", 0),
} as const;
