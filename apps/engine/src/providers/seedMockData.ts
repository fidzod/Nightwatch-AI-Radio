// Mock rows for the news/weather tables, inserted once if those tables are
// empty so the hourly news/weather reads have something real to say.
//
// These are deliberately invented, non-specific civic items with a fictional
// wire-service label — the point is to exercise "deliver facts you were handed
// without editorializing", not to assert anything about the actual world. A
// real provider replaces the *provider*, not these rows; they just stop being
// read once one is wired up.

import { countRows, getDb } from "../store.ts";

const MOCK_NEWS: {
  headline: string;
  body: string;
  category: string;
  source: string;
  minutesAgo: number;
}[] = [
  {
    headline: "Transit authority extends night-bus service on three routes",
    body: "The 14, 22 and 31 will run until 3am starting Monday, a six-month trial the authority says it will extend if ridership holds.",
    category: "local",
    source: "Meridian Wire",
    minutesAgo: 35,
  },
  {
    headline: "Power restored to the eastern districts after six-hour outage",
    body: "Roughly 4,000 households were without electricity after a substation fault. Crews finished repairs shortly before midnight.",
    category: "local",
    source: "Meridian Wire",
    minutesAgo: 70,
  },
  {
    headline: "City council defers vote on the riverside development",
    body: "The decision moves to next month's session after two hours of public comment, most of it opposed.",
    category: "local",
    source: "Meridian Wire",
    minutesAgo: 110,
  },
  {
    headline: "Rail union and operator return to talks on Thursday",
    body: "Both sides describe the gap as narrow. No strike dates have been called.",
    category: "national",
    source: "Meridian Wire",
    minutesAgo: 150,
  },
  {
    headline: "Observatory reports a clear window for the meteor shower",
    body: "Peak activity is expected between 2 and 4am, best seen away from street lighting.",
    category: "science",
    source: "Meridian Wire",
    minutesAgo: 200,
  },
  {
    headline: "Night shelter capacity raised ahead of the cold snap",
    body: "An additional 60 beds open tonight across two sites; the service line stays staffed until 6am.",
    category: "local",
    source: "Meridian Wire",
    minutesAgo: 240,
  },
  {
    headline: "Library archive digitisation reaches its halfway mark",
    body: "About 40,000 items are now searchable online, including the full run of the city's shuttered evening paper.",
    category: "culture",
    source: "Meridian Wire",
    minutesAgo: 300,
  },
];

const MOCK_WEATHER: {
  conditions: string;
  temp: number;
  unit: string;
  high: number;
  low: number;
  forecast: string;
  minutesAgo: number;
}[] = [
  {
    conditions: "overcast, light drizzle",
    temp: 9,
    unit: "C",
    high: 12,
    low: 6,
    forecast: "Drizzle easing after 3am, fog forming in low ground by dawn.",
    minutesAgo: 240,
  },
  {
    conditions: "clearing, patchy mist",
    temp: 8,
    unit: "C",
    high: 12,
    low: 5,
    forecast: "Clear through the small hours, mist lifting around sunrise.",
    minutesAgo: 120,
  },
  {
    conditions: "clear, still",
    temp: 7,
    unit: "C",
    high: 13,
    low: 5,
    forecast: "Cold and calm overnight; a bright, cool morning to follow.",
    minutesAgo: 20,
  },
];

/**
 * Inserts the mock rows only when the respective table is empty, so it is safe
 * to call on every engine boot and never fights the user's own edits.
 * Timestamps are written relative to "now" so the news always reads as tonight's.
 */
export function seedMockNewsAndWeather(): { news: number; weather: number } {
  const d = getDb();
  let news = 0;
  let weather = 0;

  if (countRows("news_items") === 0) {
    const insert = d.prepare(
      `INSERT INTO news_items
         (headline, body, category, source_label, mock_published_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`,
    );
    for (const item of MOCK_NEWS) {
      insert.run(
        item.headline,
        item.body,
        item.category,
        item.source,
        `-${item.minutesAgo} minutes`,
      );
      news += 1;
    }
  }

  if (countRows("weather_snapshots") === 0) {
    const insert = d.prepare(
      `INSERT INTO weather_snapshots
         (as_of, conditions_text, temp_value, temp_unit, high, low, forecast_text)
       VALUES (datetime('now', ?), ?, ?, ?, ?, ?, ?)`,
    );
    for (const snap of MOCK_WEATHER) {
      insert.run(
        `-${snap.minutesAgo} minutes`,
        snap.conditions,
        snap.temp,
        snap.unit,
        snap.high,
        snap.low,
        snap.forecast,
      );
      weather += 1;
    }
  }

  if (news > 0 || weather > 0) {
    console.log(
      `[store] seeded mock source data: ${news} news item(s), ${weather} weather snapshot(s)`,
    );
  }
  return { news, weather };
}
