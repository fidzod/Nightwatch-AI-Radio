// Text-to-speech via ElevenLabs Flash, rendering a script to an mp3 under
// audio/generated/.
//
// API shape verified against ElevenLabs' current docs rather than recalled:
//   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
//     ?output_format=mp3_44100_128
//   headers: xi-api-key, Content-Type: application/json
//   body:    { text, model_id }
//   200:     raw audio bytes (NOT JSON — errors are JSON, success is a file)
// Flash is `eleven_flash_v2_5` (~75ms inference), chosen in plan decision #5
// because clips are generated close to their delivery deadline.
//
// Voice selection: a real per-presenter voice hasn't been picked yet — the plan
// leaves `presenters.elevenlabs_voice_id` nullable on purpose, to be chosen by
// browsing the live ElevenLabs library against each persona's voice archetype.
// `config.elevenLabsVoiceId` is a stock library voice, overridable via
// ELEVENLABS_VOICE_ID, used only to prove the pipeline.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, requireEnv } from "../config.ts";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

export interface RenderedClip {
  /** Absolute path — this is what gets pushed to LiquidSoap's inject queue. */
  audioPath: string;
  bytes: number;
  durationSeconds: number | null;
  voiceId: string;
}

/** Filesystem-safe, sortable, collision-resistant clip filename. */
function clipFilename(triggerType: string, clipId: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}_${triggerType}_${clipId}.mp3`;
}

function probeDurationSeconds(filePath: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    const parsed = Number.parseFloat(out.trim());
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Renders `text` to an mp3 under audio/generated/ and returns its absolute path.
 *
 * Throws MissingConfigError (no API key) or an Error carrying the API's status
 * and body. Callers mark the clip 'failed' — TTS failure must never take the
 * station off the air.
 */
export async function renderSpeech(args: {
  text: string;
  triggerType: string;
  clipId: number;
  voiceId?: string;
}): Promise<RenderedClip> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const voiceId = args.voiceId ?? config.elevenLabsVoiceId;

  const url = `${API_BASE}/${encodeURIComponent(voiceId)}?output_format=${
    encodeURIComponent(config.elevenLabsOutputFormat)
  }`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: args.text,
      model_id: config.elevenLabsModel,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    // Errors come back as JSON; surface the body since ElevenLabs puts the
    // actual cause (bad voice_id, quota, invalid model) in there.
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(
      `ElevenLabs returned ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error("ElevenLabs returned an empty audio body.");
  }

  mkdirSync(config.generatedDir, { recursive: true });
  const audioPath = join(
    config.generatedDir,
    clipFilename(args.triggerType, args.clipId),
  );
  writeFileSync(audioPath, audio);

  return {
    audioPath,
    bytes: audio.byteLength,
    durationSeconds: probeDurationSeconds(audioPath),
    voiceId,
  };
}
