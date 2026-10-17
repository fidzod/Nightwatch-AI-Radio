// Weather source seam — same contract as newsProvider.ts: one narrow method,
// plain data out, shaped like a real current-conditions API response rather
// than like our `weather_snapshots` columns.
//
// `fetchCurrent` returns an ARRAY of readings rather than one. That shape
// change (from the original single-reading design) is deliberate: a real
// provider (openMeteoWeatherProvider.ts) has no free "whole country"
// aggregate API to call, so it fetches several cities spread across the
// country and hands all of them to the prompt, letting the presenter
// synthesize a natural regional summary instead of reporting one city's
// number as if it were the whole country. `MockWeatherProvider` below still
// returns a single-element array, so every existing caller (just one mock
// reading) keeps working unchanged.

import { latestWeatherSnapshot } from "../store.ts";

export interface WeatherReading {
  /** ISO 8601 observation time. */
  asOf: string;
  /** City/region name this reading is for — always set so a multi-reading
   *  list can be attributed per-reading in the prompt. */
  location: string;
  conditions: string;
  temperature: { value: number | null; unit: string };
  high: number | null;
  low: number | null;
  forecast: string | null;
}

export interface WeatherProvider {
  /** Current conditions for one or more locations, or null if the source has
   *  nothing (station then skips the weather read rather than inventing
   *  numbers — the personas are under standing orders never to invent
   *  facts). Never an empty array — empty means null. */
  fetchCurrent(): Promise<WeatherReading[] | null>;
}

export class MockWeatherProvider implements WeatherProvider {
  async fetchCurrent(): Promise<WeatherReading[] | null> {
    const row = latestWeatherSnapshot();
    if (row === undefined) return null;
    return [
      {
        asOf: row.as_of.replace(" ", "T") + "Z",
        location: "the station's home city",
        conditions: row.conditions_text,
        temperature: { value: row.temp_value, unit: row.temp_unit ?? "C" },
        high: row.high,
        low: row.low,
        forecast: row.forecast_text,
      },
    ];
  }
}

/** Renders one reading as `{temp, conditions, forecast}`. */
function formatOneReading(reading: WeatherReading): string {
  const parts: string[] = [];
  if (reading.temperature.value !== null) {
    parts.push(`${reading.temperature.value}°${reading.temperature.unit}`);
  }
  parts.push(reading.conditions);
  if (reading.high !== null || reading.low !== null) {
    parts.push(
      `high ${reading.high ?? "?"}°, low ${reading.low ?? "?"}°`,
    );
  }
  if (reading.forecast) parts.push(reading.forecast);
  return parts.join(", ");
}

/**
 * Renders the weather prompt's raw-data slot. A single reading (the mock
 * provider, or a capital-only country) renders exactly as before — a plain
 * "12°C, overcast, high 14°, low 8°" line. Multiple readings (a real country
 * with several cities) render one `- City: ...` line each, so the presenter's
 * prompt can see the regional spread and summarize it rather than being
 * handed a single number to pass off as the whole country's weather.
 */
export function formatWeatherForPrompt(readings: WeatherReading[]): string {
  if (readings.length === 1) return formatOneReading(readings[0]!);
  return readings
    .map((r) => `- ${r.location}: ${formatOneReading(r)}`)
    .join("\n");
}
