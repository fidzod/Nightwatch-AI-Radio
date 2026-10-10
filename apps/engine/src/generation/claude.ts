// Script generation via the Claude API (official @anthropic-ai/sdk).
//
// Phase 2 implements exactly one of the user's seven trigger templates: the
// filler one-liner (#7), the smallest input template — it needs no track
// metadata, only the current time and the collection name. The other six
// arrive in Phase 3.
//
// Model choice: the plan's locked-in decision #5 is "Claude API (Sonnet
// family) for scripts", so `config.claudeModel` defaults to `claude-sonnet-5`
// rather than the general-purpose Opus default.

import Anthropic from "@anthropic-ai/sdk";
import { config, requireEnv } from "../config.ts";
import { WREN } from "../personas/wren.ts";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client === undefined) {
    // Read through requireEnv first so a missing key produces our actionable
    // MissingConfigError instead of the SDK's generic constructor throw.
    client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  }
  return client;
}

export interface FillerContext {
  /** Human-readable local time, e.g. "11:48pm" — the station's voice talks in
   *  12-hour time, so format for the prompt, not for machines. */
  currentTime: string;
  /** Collection name, as the listener would hear it. */
  playlistName: string;
}

/** Formats a Date the way the station's voice would say it. */
export function formatStationTime(now: Date = new Date()): string {
  return now
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(" AM", "am")
    .replace(" PM", "pm");
}

/**
 * The user's trigger-prompt template #7, verbatim. Kept as a function of the
 * context rather than inlined so Phase 3 can hold all seven templates in one
 * shape.
 */
export function buildFillerPrompt(ctx: FillerContext): string {
  return `Time: ${ctx.currentTime}
Collection playing: ${ctx.playlistName}

Write ONE short line (under 15 words) — a passing thought, not tied to any specific song. Something a tired, kind late-night host might murmur.`;
}

/**
 * Generates one filler one-liner in Wren's voice.
 *
 * Throws MissingConfigError (no API key) or an Anthropic.APIError subclass.
 * Callers are expected to catch and mark the clip 'failed' — a failed
 * generation must never take the station off the air.
 */
export async function generateFillerScript(
  ctx: FillerContext,
): Promise<string> {
  // A 15-word murmur needs no reasoning, and clips are generated close to
  // their delivery deadline, so latency matters more than depth here:
  // thinking off, and a max_tokens sized for a deliberately short output.
  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: 256,
    thinking: { type: "disabled" },
    system: WREN.systemPrompt,
    messages: [{ role: "user", content: buildFillerPrompt(ctx) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Claude declined to generate the script (category: ${
        response.stop_details?.category ?? "unknown"
      }).`,
    );
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (text === "") {
    throw new Error(
      `Claude returned no text (stop_reason: ${response.stop_reason}).`,
    );
  }

  // The system prompt already forbids stage directions and asterisks, but the
  // text goes straight into a voice engine, so strip stray markdown emphasis
  // and surrounding quotes rather than trusting it to always comply.
  return text.replace(/[*_]/g, "").replace(/^["'“”]|["'“”]$/g, "").trim();
}
