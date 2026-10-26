// The seven trigger-prompt templates, reproduced from the user's original
// design VERBATIM. They are the station's voice as much as the system prompts
// are — do not reword, re-order or "tighten" them.
//
// Each one becomes the single user turn of a Claude call whose system prompt is
// the active presenter's `presenters.system_prompt` column, used as-is. That
// pairing (live DB persona + fixed template) is the whole generation contract.

import type { NewsItem } from "../providers/newsProvider.ts";
import { formatNewsForPrompt } from "../providers/newsProvider.ts";
import type { WeatherReading } from "../providers/weatherProvider.ts";
import { formatWeatherForPrompt } from "../providers/weatherProvider.ts";
import type { TriggerType } from "../scheduler/types.ts";

/** Fields every template needs. `currentTime` is spoken-style ("11:48pm"). */
interface BaseContext {
  currentTime: string;
  /** Stable identity of the trigger instance — see store.clipExistsForDedupeKey. */
  dedupeKey: string;
  /**
   * ISO instant the clip is scheduled to air. Metadata only — never rendered
   * into a prompt — but it is stamped into `generated_clips.context_json` by
   * the scheduler, which makes a clip row self-describing ("this was meant for
   * 23:59:30") without a schema change.
   */
  fireAt?: string;
}

export interface SongIntroContext extends BaseContext {
  triggerType: "song_intro";
  playlistName: string;
  lastSongTitle: string | null;
  lastArtist: string | null;
  nextSongTitle: string | null;
  nextArtist: string | null;
  moodTag: string | null;
}

export interface ChangeoverContext extends BaseContext {
  triggerType: "changeover";
  oldPlaylistName: string;
  newPlaylistName: string;
  moodTag: string | null;
}

export interface HourOpenContext extends BaseContext {
  triggerType: "hour_open";
  playlistName: string;
}

export interface NewsContext extends BaseContext {
  triggerType: "news";
  items: NewsItem[];
}

export interface WeatherContext extends BaseContext {
  triggerType: "weather";
  /**
   * One or more regional readings (see providers/weatherProvider.ts) — a real
   * provider has no single "whole country" number to hand over, so it passes
   * several spread-out cities and lets the write-up synthesize the picture.
   */
  readings: WeatherReading[];
}

export interface SignOffContext extends BaseContext {
  triggerType: "sign_off";
  playlistName: string;
}

export interface FillerContext extends BaseContext {
  triggerType: "filler";
  playlistName: string;
}

export type MomentContext =
  | SongIntroContext
  | ChangeoverContext
  | HourOpenContext
  | NewsContext
  | WeatherContext
  | SignOffContext
  | FillerContext;

/**
 * "Title by Artist", or just the title when the artist is unknown.
 *
 * The one place the templates are not reproduced character-for-character: the
 * original reads `{last_song_title} by {last_artist}`, and `tracks.artist` is
 * nullable (the current library has titles but no artist tags). Writing
 * "by null"/"by unknown artist" would invite the presenter to say it out loud,
 * so the "by …" clause is dropped when there is no artist to credit.
 */
function song(title: string | null, artist: string | null): string {
  const name = title ?? "untitled";
  return artist ? `${name} by ${artist}` : name;
}

function vibe(moodTag: string | null): string {
  return moodTag ?? "unspecified";
}

/** Builds the user turn for one moment. */
export function buildPrompt(ctx: MomentContext): string {
  switch (ctx.triggerType) {
    case "song_intro":
      return `Time: ${ctx.currentTime}
Collection playing: ${ctx.playlistName}
Song ending: ${song(ctx.lastSongTitle, ctx.lastArtist)}
Song coming up: ${song(ctx.nextSongTitle, ctx.nextArtist)}
Vibe tag: ${vibe(ctx.moodTag)}

Write a 2-3 sentence transition. You may reference either song by title/artist, or neither — your call, whatever feels most natural. Do not summarize both songs mechanically.`;

    case "changeover":
      return `Time: ${ctx.currentTime}
Outgoing collection: ${ctx.oldPlaylistName}
Incoming collection: ${ctx.newPlaylistName}
Vibe tag: ${vibe(ctx.moodTag)}

Write a short 2-3 sentence handoff letting the listener know the mood is shifting. Don't explain why — just mark the change, the way a DJ would.`;

    case "hour_open":
      return `Time: ${ctx.currentTime}, exactly on the hour
Collection playing: ${ctx.playlistName}

Write a 1-2 sentence hour marker to lead into the news. Should feel like a small ritual, not an announcement.`;

    case "news":
      return `Time: ${ctx.currentTime}
Raw news items (do not alter facts, just deliver in your voice):
${formatNewsForPrompt(ctx.items)}

Write a spoken news read, roughly 35-60 seconds long. Deliver items in order of what a listener would most want to know first. No sensationalism. If an item is grim, don't soften the facts, just don't editorialize. Don't state the time, the hour marker just gave it. The weather follows immediately after this, so don't hand back to the music or signal that this segment is over.`;

    case "weather": {
      const multi = ctx.readings.length > 1;
      return `Time: ${ctx.currentTime}
Raw weather data${multi ? " (several regions — summarize the overall picture, don't just list cities)" : ""}:
${formatWeatherForPrompt(ctx.readings)}

Write a 2-3 sentence weather read, practical but in character. Don't state the time, the hour marker just gave it.`;
    }

    case "sign_off":
      return `Time: ${ctx.currentTime}
Collection that was playing: ${ctx.playlistName}

Write a 2-3 sentence sign-off. Should feel like closing a door gently, not ending a show.`;

    case "filler":
      return `Time: ${ctx.currentTime}
Collection playing: ${ctx.playlistName}

Write ONE short line (under 15 words) — a passing thought, not tied to any specific song. Something a tired, kind late-night host might murmur.`;
  }
}

/**
 * Output budget per moment. Sized to the template's own ask: a 15-word murmur
 * needs nothing, a 20-40 second news read needs room for ~120 words. Keeping
 * these tight is also a latency lever — clips are generated close to their
 * delivery deadline.
 */
export function maxTokensFor(triggerType: TriggerType): number {
  switch (triggerType) {
    case "news":
      return 1024;
    case "filler":
      return 256;
    default:
      return 512;
  }
}
