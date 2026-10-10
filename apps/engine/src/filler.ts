// Filler one-liner orchestration — the single end-to-end chain Phase 2 proves:
//
//   DB (collection + presenter)
//     -> Claude   (script, Wren's voice, trigger template #7)
//     -> ElevenLabs Flash  (mp3 under audio/generated/)
//     -> generated_clips   (pending -> rendering -> ready -> used)
//     -> LiquidSoap inject queue (telnet)
//
// Phase 3 replaces the *triggering* of this with the real rule matrix (song
// intro probability, hourly news/weather, changeover, sign-off) and the ~5s
// scheduler loop. The chain below is what those triggers will call.

import { MissingConfigError, config } from "./config.ts";
import {
  formatStationTime,
  generateFillerScript,
} from "./generation/claude.ts";
import { renderSpeech } from "./generation/elevenlabs.ts";
import { pushToInjectQueue } from "./liquidsoapClient.ts";
import {
  createClip,
  ensureCollection,
  ensurePresenter,
  getPresenterVoiceId,
  updateClip,
} from "./store.ts";

export interface FillerResult {
  clipId: number;
  status: "used" | "ready" | "failed";
  scriptText?: string;
  audioPath?: string;
  durationSeconds?: number | null;
  requestId?: string;
  error?: string;
}

/**
 * Runs the full filler chain once.
 *
 * Never throws: every failure is recorded on the clip row as 'failed' and
 * returned to the caller. A broken generation must never take the station off
 * the air — LiquidSoap just keeps pulling music from /next-music.
 *
 * `deliver: false` stops after 'ready' (useful for testing generation without
 * a running LiquidSoap).
 */
export async function runFillerOnce(
  options: { deliver?: boolean } = {},
): Promise<FillerResult> {
  const deliver = options.deliver ?? true;

  const presenterId = ensurePresenter();
  const playlistName = config.testCollectionName;
  ensureCollection(playlistName);

  const context = {
    currentTime: formatStationTime(),
    playlistName,
  };

  const clipId = createClip({
    triggerType: "filler",
    presenterId,
    context,
  });

  // --- script ---------------------------------------------------------------
  let scriptText: string;
  try {
    scriptText = await generateFillerScript(context);
  } catch (err) {
    const message = errorMessage(err);
    updateClip(clipId, { status: "failed" });
    logFailure("script generation", err);
    return { clipId, status: "failed", error: message };
  }
  updateClip(clipId, { status: "rendering", script_text: scriptText });
  console.log(`[filler] clip ${clipId} script: ${JSON.stringify(scriptText)}`);

  // --- text to speech -------------------------------------------------------
  // Prefer the voice chosen for this presenter in the web UI (Presenters page);
  // fall back to the stock test voice only if none has been set yet.
  const voiceId = getPresenterVoiceId(presenterId) ?? undefined;

  let rendered;
  try {
    rendered = await renderSpeech({
      text: scriptText,
      triggerType: "filler",
      clipId,
      voiceId,
    });
  } catch (err) {
    const message = errorMessage(err);
    updateClip(clipId, { status: "failed" });
    logFailure("speech rendering", err);
    return { clipId, status: "failed", scriptText, error: message };
  }

  updateClip(clipId, {
    status: "ready",
    audio_path: rendered.audioPath,
    voice_id_used: rendered.voiceId,
    duration_seconds: rendered.durationSeconds,
  });
  console.log(
    `[filler] clip ${clipId} ready: ${rendered.audioPath} ` +
      `(${rendered.bytes} bytes, ${rendered.durationSeconds ?? "?"}s)`,
  );

  if (!deliver) {
    return {
      clipId,
      status: "ready",
      scriptText,
      audioPath: rendered.audioPath,
      durationSeconds: rendered.durationSeconds,
    };
  }

  // --- delivery -------------------------------------------------------------
  // Only flips to 'used' once LiquidSoap has actually accepted the push; a
  // clip left at 'ready' is one that generated fine but never aired.
  try {
    const requestId = await pushToInjectQueue(rendered.audioPath);
    updateClip(clipId, { status: "used", markUsed: true });
    console.log(
      `[filler] clip ${clipId} pushed to inject queue (request ${requestId})`,
    );
    return {
      clipId,
      status: "used",
      scriptText,
      audioPath: rendered.audioPath,
      durationSeconds: rendered.durationSeconds,
      requestId,
    };
  } catch (err) {
    logFailure("delivery to LiquidSoap", err);
    return {
      clipId,
      status: "ready",
      scriptText,
      audioPath: rendered.audioPath,
      durationSeconds: rendered.durationSeconds,
      error: errorMessage(err),
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logFailure(stage: string, err: unknown): void {
  if (err instanceof MissingConfigError) {
    // Expected before the user has created .env — a clear instruction, not a
    // stack trace.
    console.error(`[filler] ${stage} skipped — ${err.message}`);
  } else {
    console.error(`[filler] ${stage} failed —`, err);
  }
}
