// Real weather provider — Open-Meteo (https://open-meteo.com), a free,
// keyless forecast API. Confirmed live against the real endpoint while
// building this (see the engine task notes): a GET to
//   https://api.open-meteo.com/v1/forecast
//     ?latitude=<lat>&longitude=<lon>&current_weather=true
//     &daily=temperature_2m_max,temperature_2m_min&timezone=auto
// returns JSON shaped like:
//   { "current_weather": { "temperature": 12.3, "windspeed": 15.5,
//       "weathercode": 3, "time": "2026-10-17T18:00", ... },
//     "daily": { "time": [...7 dates], "temperature_2m_max": [...],
//       "temperature_2m_min": [...] } }
// `daily[0]` is always today, so today's high/low come from index 0.
//
// There is no free "whole country" aggregate forecast API, so the compromise
// (per the plan) is: fetch one reading per city in the country's
// `countryData.ts` entry (capital + any extra spread cities), and hand ALL of
// them to the prompt as a `WeatherReading[]` rather than picking just one —
// the presenter's script-writing step then synthesizes a natural regional
// summary ("mild in the south, showers moving into the north") instead of
// reporting a single city's number as if it were the whole country.

import { countryInfoFor } from "./countryData.ts";
import type { WeatherProvider, WeatherReading } from "./weatherProvider.ts";

/** WMO weather codes (the `weathercode` field) collapsed to short English
 *  text. Open-Meteo's `current_weather` only gives you the numeric code —
 *  this table is the standard WMO mapping, trimmed to what's actually useful
 *  spoken aloud. See https://open-meteo.com/en/docs for the full code list. */
const WMO_CONDITIONS: Record<number, string> = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
};

function describeConditions(code: number): string {
  return WMO_CONDITIONS[code] ?? `conditions code ${code}`;
}

interface OpenMeteoResponse {
  current_weather?: {
    time: string;
    temperature: number;
    weathercode: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
}

async function fetchCity(
  cityName: string,
  lat: number,
  lon: number,
): Promise<WeatherReading | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    throw new Error(`Open-Meteo ${res.status} for ${cityName}`);
  }
  const body = (await res.json()) as OpenMeteoResponse;
  const current = body.current_weather;
  if (current === undefined) return null;

  return {
    // Open-Meteo's `current_weather.time` is "YYYY-MM-DDTHH:mm" (local time,
    // per `timezone=auto`) with no seconds — pad it out so it's valid ISO
    // 8601, same as the mock provider's `asOf` values.
    asOf: current.time.length === 16 ? `${current.time}:00` : current.time,
    location: cityName,
    conditions: describeConditions(current.weathercode),
    temperature: { value: current.temperature, unit: "C" },
    high: body.daily?.temperature_2m_max?.[0] ?? null,
    low: body.daily?.temperature_2m_min?.[0] ?? null,
    forecast: null,
  };
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  private readonly countryCode: () => string;

  /**
   * `countryCode` is a function, not a captured string, so a `/settings`
   * change takes effect on the provider's next fetch without reconstructing
   * it — same convention as GoogleNewsRssProvider.
   */
  constructor(countryCode: () => string) {
    this.countryCode = countryCode;
  }

  async fetchCurrent(): Promise<WeatherReading[] | null> {
    const info = countryInfoFor(this.countryCode());
    const results = await Promise.allSettled(
      info.cities.map((city) => fetchCity(city.name, city.lat, city.lon)),
    );

    const readings: WeatherReading[] = [];
    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled" && result.value !== null) {
        readings.push(result.value);
      } else if (result.status === "rejected") {
        console.warn(
          `[weather] Open-Meteo fetch failed for ${info.cities[i]!.name} —`,
          result.reason,
        );
      }
    }
    // Station policy (see weatherProvider.ts): never invent a reading, so an
    // all-failed fetch returns null and the scheduler skips the weather
    // moment entirely rather than airing nothing-but-silence pretending to be
    // data.
    return readings.length > 0 ? readings : null;
  }
}
