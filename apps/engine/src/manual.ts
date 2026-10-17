// Manual trigger plumbing for GET|POST /trigger/<type>.
//
// Not part of the scheduler: this exists so any one of the seven moments can be
// fired on demand — proving a trigger type end to end, hearing how a persona
// reads a given template, or re-checking injection after a change to radio.liq
// — without waiting for the clock to reach its window.
//
// Context comes from the live schedule where possible (so a manual fire sounds
// exactly like the real thing), with `?presenter=` / `?collection=` overrides
// for when the station is off air or a different persona is wanted.

import { config } from "./config.ts";
import { formatStationTime } from "./generation/claude.ts";
import type { MomentContext } from "./generation/prompts.ts";
import type { MomentPlan } from "./moment.ts";
import { countryInfoFor } from "./providers/countryData.ts";
import { GoogleNewsRssProvider } from "./providers/googleNewsRssProvider.ts";
import { OpenMeteoWeatherProvider } from "./providers/openMeteoWeatherProvider.ts";
import { getCountry, loadScheduleSnapshot, pickNextTrack } from "./store.ts";
import { resolveActiveSlot } from "./scheduler/resolveActiveSlot.ts";
import type {
  CollectionRow,
  PresenterRow,
  TriggerType,
} from "./scheduler/types.ts";

// Real providers, matching the scheduler's production wiring (server.ts) —
// a hand-fired `/trigger/news` or `/trigger/weather` should sound like the
// real thing, not read from the mock seed rows. Both read the country fresh
// on every call via `getCountry()`, so a `/settings` change applies without
// restarting the engine.
const news = new GoogleNewsRssProvider(
  () => countryInfoFor(getCountry()).language,
  () => getCountry(),
);
const weather = new OpenMeteoWeatherProvider(() => getCountry());

export class ManualTriggerError extends Error {}

/** Matches a presenter/collection by numeric id or by (case-insensitive) name. */
function findBy<T extends { id: number; name: string }>(
  rows: Iterable<T>,
  ref: string,
): T | undefined {
  const asId = Number.parseInt(ref, 10);
  for (const row of rows) {
    if (String(row.id) === ref || row.id === asId) return row;
    if (row.name.toLowerCase() === ref.toLowerCase()) return row;
  }
  return undefined;
}

/**
 * Builds a plan for one manually-triggered moment.
 *
 * Throws ManualTriggerError with an actionable message when the station has no
 * presenter/collection to speak as — the route turns that into a 400 rather
 * than a half-formed clip.
 */
export async function buildManualPlan(args: {
  triggerType: TriggerType;
  presenterRef?: string | null;
  collectionRef?: string | null;
  now?: Date;
}): Promise<MomentPlan> {
  const now = args.now ?? new Date();
  const snapshot = loadScheduleSnapshot();
  const active = resolveActiveSlot(snapshot, now);

  let presenter: PresenterRow | undefined = active?.presenter;
  if (args.presenterRef) {
    presenter = findBy(snapshot.presenters.values(), args.presenterRef);
    if (presenter === undefined) {
      throw new ManualTriggerError(`No presenter matches "${args.presenterRef}".`);
    }
  }
  presenter ??= [...snapshot.presenters.values()].find((p) => p.active === 1);
  if (presenter === undefined) {
    throw new ManualTriggerError(
      "No presenters exist yet — create one on the web UI's Presenters page.",
    );
  }

  let collection: CollectionRow | undefined = active?.collection;
  if (args.collectionRef) {
    collection = findBy(snapshot.collections.values(), args.collectionRef);
    if (collection === undefined) {
      throw new ManualTriggerError(
        `No collection matches "${args.collectionRef}".`,
      );
    }
  }
  collection ??= [...snapshot.collections.values()][0];
  if (collection === undefined) {
    throw new ManualTriggerError(
      "No collections exist yet — create one on the web UI's Collections page.",
    );
  }

  const currentTime = formatStationTime(now);
  // `manual:` prefix keeps hand-fired clips out of the scheduler's dedupe
  // space, so testing a moment can never suppress the scheduled one.
  const dedupeKey = `manual:${args.triggerType}:${now.toISOString()}`;

  const context = await buildManualContext({
    triggerType: args.triggerType,
    currentTime,
    dedupeKey,
    collection,
    snapshotCollections: [...snapshot.collections.values()],
  });

  return {
    triggerType: args.triggerType,
    presenter,
    scheduleSlotId: active?.slot.id ?? null,
    context: { ...context, fireAt: now.toISOString() },
  };
}

async function buildManualContext(args: {
  triggerType: TriggerType;
  currentTime: string;
  dedupeKey: string;
  collection: CollectionRow;
  snapshotCollections: CollectionRow[];
}): Promise<MomentContext> {
  const { currentTime, dedupeKey, collection } = args;

  switch (args.triggerType) {
    case "filler":
      return {
        triggerType: "filler",
        currentTime,
        dedupeKey,
        playlistName: collection.name,
      };
    case "hour_open":
      return {
        triggerType: "hour_open",
        currentTime,
        dedupeKey,
        playlistName: collection.name,
      };
    case "sign_off":
      return {
        triggerType: "sign_off",
        currentTime,
        dedupeKey,
        playlistName: collection.name,
      };
    case "changeover": {
      // Hand off from some other collection if one exists, so the template has
      // a real outgoing name rather than a placeholder.
      const other = args.snapshotCollections.find((c) => c.id !== collection.id);
      return {
        triggerType: "changeover",
        currentTime,
        dedupeKey,
        oldPlaylistName: other?.name ?? `${collection.name} (earlier)`,
        newPlaylistName: collection.name,
        moodTag: collection.mood_tag,
      };
    }
    case "song_intro": {
      const ending = pickNextTrack(collection.id);
      const upcoming = pickNextTrack(collection.id, ending?.id);
      return {
        triggerType: "song_intro",
        currentTime,
        dedupeKey,
        playlistName: collection.name,
        lastSongTitle: ending?.title ?? null,
        lastArtist: ending?.artist ?? null,
        nextSongTitle: upcoming?.title ?? null,
        nextArtist: upcoming?.artist ?? null,
        moodTag: collection.mood_tag,
      };
    }
    case "news": {
      const items = await news.fetchLatestNews(config.newsItemCount);
      if (items.length === 0) {
        throw new ManualTriggerError(
          "No news items available. The Google News RSS fetch failed or returned nothing.",
        );
      }
      return { triggerType: "news", currentTime, dedupeKey, items };
    }
    case "weather": {
      const readings = await weather.fetchCurrent();
      if (readings === null) {
        throw new ManualTriggerError(
          "No weather reading available. The forecast fetch failed or returned nothing.",
        );
      }
      return { triggerType: "weather", currentTime, dedupeKey, readings };
    }
  }
}
