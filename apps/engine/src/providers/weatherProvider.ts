// Weather source seam — same contract as newsProvider.ts: one narrow method,
// plain data out, shaped like a real current-conditions API response rather
// than like our `weather_snapshots` columns.

import { latestWeatherSnapshot } from "../store.ts";

export interface WeatherReading {
  /** ISO 8601 observation time. */
  asOf: string;
  conditions: string;
  temperature: { value: number | null; unit: string };
  high: number | null;
  low: number | null;
  forecast: string | null;
}

export interface WeatherProvider {
  /** Current conditions, or null if the source has nothing (station then skips
   *  the weather read rather than inventing numbers — the personas are under
   *  standing orders never to invent facts). */
  fetchCurrent(): Promise<WeatherReading | null>;
}

export class MockWeatherProvider implements WeatherProvider {
  async fetchCurrent(): Promise<WeatherReading | null> {
    const row = latestWeatherSnapshot();
    if (row === undefined) return null;
    return {
      asOf: row.as_of.replace(" ", "T") + "Z",
      conditions: row.conditions_text,
      temperature: { value: row.temp_value, unit: row.temp_unit ?? "C" },
      high: row.high,
      low: row.low,
      forecast: row.forecast_text,
    };
  }
}

/** Renders the `{temp, conditions, forecast}` slot of the weather prompt. */
export function formatWeatherForPrompt(reading: WeatherReading): string {
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
