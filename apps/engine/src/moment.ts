// The one generation chain, shared by all seven moment types:
//
//   generated_clips row ('pending')
//     -> Claude            (active presenter's system_prompt + the moment's template)
//     -> ElevenLabs Flash  (mp3 under audio/generated/, presenter's chosen voice)
//     -> 'ready'           (pre-rendered, not yet aired)
//     -> LiquidSoap inject queue, 'used'
//
// `generateMoment` and `deliverMoment` are deliberately separate calls, not one
// function: that split IS the plan's pre-render-ahead / just-in-time-delivery
// design. The scheduler generates while a trigger is still up to ~180s away and
// pushes seconds before it should air, so a slow Claude or ElevenLabs call never
// delays the stream. `runMoment` glues them for the manual /trigger endpoints.

import { MissingConfigError } from "./config.ts";
import { generateScript } from "./generation/claude.ts";
import type { MomentContext } from "./generation/prompts.ts";
import { renderSpeech } from "./generation/elevenlabs.ts";
import { pushToInjectQueue } from "./liquidsoapClient.ts";
import type { PresenterRow, TriggerType } from "./scheduler/types.ts";
import { createClip, updateClip } from "./store.ts";

export interface MomentPlan {
  triggerType: TriggerType;
  presenter: PresenterRow;
  scheduleSlotId: number | null;
  context: MomentContext;
}

export interface MomentResult {
  clipId: number;
  triggerType: TriggerType;
  presenterName: string;
  status: "used" | "ready" | "failed";
  scriptText?: string;
  audioPath?: string;
  durationSeconds?: number | null;
  voiceId?: string;
  requestId?: string;
  error?: string;
}

/**
 * Script + TTS for one moment, leaving the clip at 'ready' (or 'failed').
 *
 * Never throws: every failure is recorded on the clip row and returned. A
 * broken generation must never take the station off the air — LiquidSoap just
 * keeps pulling music from /next-music.
 */
export async function generateMoment(plan: MomentPlan): Promise<MomentResult> {
  const { triggerType, presenter, context } = plan;
  const label = `[moment:${triggerType}]`;

  // Insert first, at 'pending', so the dedupe key is visible to the next
  // scheduler tick before the (slow) API calls start — that's what stops a
  // trigger from being generated twice while the first attempt is in flight.
  const clipId = createClip({
    triggerType,
    presenterId: presenter.id,
    scheduleSlotId: plan.scheduleSlotId,
    context,
  });

  const base = { clipId, triggerType, presenterName: presenter.name };

  let scriptText: string;
  try {
    scriptText = await generateScript({ presenter, context });
  } catch (err) {
    updateClip(clipId, { status: "failed" });
    logFailure(label, "script generation", err);
    return { ...base, status: "failed", error: errorMessage(err) };
  }
  updateClip(clipId, { status: "rendering", script_text: scriptText });
  console.log(
    `${label} clip ${clipId} (${presenter.name}) script: ${JSON.stringify(scriptText)}`,
  );

  // Prefer the voice chosen for this presenter in the web UI (Presenters page);
  // fall back to the stock test voice only if none has been set yet.
  const voiceId = presenter.elevenlabs_voice_id ?? undefined;

  let rendered;
  try {
    rendered = await renderSpeech({ text: scriptText, triggerType, clipId, voiceId });
  } catch (err) {
    updateClip(clipId, { status: "failed" });
    logFailure(label, "speech rendering", err);
    return { ...base, status: "failed", scriptText, error: errorMessage(err) };
  }

  updateClip(clipId, {
    status: "ready",
    audio_path: rendered.audioPath,
    voice_id_used: rendered.voiceId,
    duration_seconds: rendered.durationSeconds,
  });
  console.log(
    `${label} clip ${clipId} ready: ${rendered.audioPath} ` +
      `(${rendered.bytes} bytes, ${rendered.durationSeconds ?? "?"}s, voice ${rendered.voiceId})`,
  );

  return {
    ...base,
    status: "ready",
    scriptText,
    audioPath: rendered.audioPath,
    durationSeconds: rendered.durationSeconds,
    voiceId: rendered.voiceId,
  };
}

/**
 * Pushes a 'ready' clip into LiquidSoap and flips it to 'used'.
 *
 * Only flips on a confirmed push: a clip left at 'ready' is one that generated
 * fine but never aired, which is exactly the distinction the status lifecycle
 * exists to record. Returns LiquidSoap's request id, or null if the push failed
 * (the error is logged; the caller decides whether to retry or abandon).
 */
export async function deliverMoment(
  clipId: number,
  audioPath: string,
): Promise<string | null> {
  try {
    const requestId = await pushToInjectQueue(audioPath);
    updateClip(clipId, { status: "used", markUsed: true });
    console.log(`[moment] clip ${clipId} pushed to inject queue (request ${requestId})`);
    return requestId;
  } catch (err) {
    logFailure("[moment]", "delivery to LiquidSoap", err);
    return null;
  }
}

/** Generate and (optionally) deliver in one call — the manual trigger path. */
export async function runMoment(
  plan: MomentPlan,
  options: { deliver?: boolean } = {},
): Promise<MomentResult> {
  const result = await generateMoment(plan);
  if (result.status !== "ready" || options.deliver === false) return result;

  const requestId = await deliverMoment(result.clipId, result.audioPath!);
  return requestId === null
    ? { ...result, error: "LiquidSoap push failed — clip left at 'ready'." }
    : { ...result, status: "used", requestId };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logFailure(label: string, stage: string, err: unknown): void {
  if (err instanceof MissingConfigError) {
    // Expected before the user has created .env — a clear, actionable message
    // rather than a stack trace.
    console.error(`${label} ${stage} skipped — ${err.message}`);
  } else {
    console.error(`${label} ${stage} failed —`, err);
  }
}
