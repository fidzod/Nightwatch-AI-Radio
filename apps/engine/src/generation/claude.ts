// Script generation via the Claude API (official @anthropic-ai/sdk).
//
// One function, generic over all seven moment types: the system prompt is
// whichever presenter the scheduler resolved from the `presenters` table (used
// verbatim, so a system-prompt edit in the web UI takes effect on the very next
// generation), and the user turn is that moment's template from prompts.ts.
//
// Model choice: the plan's locked-in decision #5 is "Claude API (Sonnet
// family) for scripts", so `config.claudeModel` defaults to `claude-sonnet-5`
// rather than the general-purpose Opus default.

import Anthropic from "@anthropic-ai/sdk";
import { config, requireEnv } from "../config.ts";
import type { PresenterRow } from "../scheduler/types.ts";
import { buildPrompt, maxTokensFor, type MomentContext } from "./prompts.ts";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client === undefined) {
    // Read through requireEnv first so a missing key produces our actionable
    // MissingConfigError instead of the SDK's generic constructor throw.
    client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  }
  return client;
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
 * Generates one spoken script in the active presenter's voice.
 *
 * Throws MissingConfigError (no API key) or an Anthropic.APIError subclass.
 * Callers are expected to catch and mark the clip 'failed' — a failed
 * generation must never take the station off the air.
 */
export async function generateScript(args: {
  presenter: PresenterRow;
  context: MomentContext;
}): Promise<string> {
  // These are short spoken lines, generated close to their delivery deadline,
  // so latency matters more than depth: thinking off, max_tokens sized to the
  // template's own ask.
  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: maxTokensFor(args.context.triggerType),
    thinking: { type: "disabled" },
    system: args.presenter.system_prompt,
    messages: [{ role: "user", content: buildPrompt(args.context) }],
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

  // The system prompts already forbid stage directions and asterisks, but the
  // text goes straight into a voice engine, so strip stray markdown emphasis
  // and surrounding quotes rather than trusting it to always comply.
  return text.replace(/[*_]/g, "").replace(/^["'“”]|["'“”]$/g, "").trim();
}
