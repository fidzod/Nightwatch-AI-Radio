// Static ISO 3166-1 alpha-2 country -> {language, cities} lookup.
//
// This backs the real news/weather providers: `language` picks the Google
// News locale (`hl`/`ceid`), and `cities` gives the weather provider
// somewhere to fetch Open-Meteo coordinates from. There is no free "whole
// country" weather aggregate API, so the compromise (per the plan) is to
// fetch several spread-out cities per country and hand all of them to the
// prompt, so the presenter can synthesize a natural regional summary instead
// of reporting one city's number as if it were the whole country.
//
// Coverage is deliberately NOT exhaustive (~195 countries exist) — this is a
// hand-curated list of ~50 commonly-used countries spanning every inhabited
// continent, picked for being plausible choices on a `/settings` dropdown.
// Most entries carry 2-5 cities picked to spread across the country's
// geography (coasts, north/south, etc). A handful of smaller/city-state
// entries are intentionally capital-only (noted inline below) — that's an
// accepted fallback, not an oversight; a single reading is still a strict
// improvement over the old fully-mocked data.
//
// Not meant to be exhaustive or to editorialize about disputed naming/borders
// — names are whatever's in common English usage, codes are plain ISO 3166-1.

export interface CityCoords {
  name: string;
  lat: number;
  lon: number;
}

export interface CountryInfo {
  name: string;
  /** BCP-47-ish language/locale code used for Google News' `hl`/`ceid`. */
  language: string;
  /** Capital (or largest city) first, then a geographic spread of others. */
  cities: CityCoords[];
}

export const COUNTRIES: Record<string, CountryInfo> = {
  // --- Europe ---------------------------------------------------------------
  GB: {
    name: "United Kingdom",
    language: "en",
    cities: [
      { name: "London", lat: 51.5074, lon: -0.1278 },
      { name: "Manchester", lat: 53.4808, lon: -2.2426 },
      { name: "Edinburgh", lat: 55.9533, lon: -3.1883 },
      { name: "Cardiff", lat: 51.4816, lon: -3.1791 },
      { name: "Belfast", lat: 54.5973, lon: -5.9301 },
    ],
  },
  IE: {
    name: "Ireland",
    language: "en",
    cities: [
      { name: "Dublin", lat: 53.3498, lon: -6.2603 },
      { name: "Cork", lat: 51.8985, lon: -8.4756 },
      { name: "Galway", lat: 53.2707, lon: -9.0568 },
    ],
  },
  FR: {
    name: "France",
    language: "fr",
    cities: [
      { name: "Paris", lat: 48.8566, lon: 2.3522 },
      { name: "Marseille", lat: 43.2965, lon: 5.3698 },
      { name: "Lyon", lat: 45.764, lon: 4.8357 },
      { name: "Lille", lat: 50.6292, lon: 3.0573 },
      { name: "Bordeaux", lat: 44.8378, lon: -0.5792 },
    ],
  },
  DE: {
    name: "Germany",
    language: "de",
    cities: [
      { name: "Berlin", lat: 52.52, lon: 13.405 },
      { name: "Munich", lat: 48.1351, lon: 11.582 },
      { name: "Hamburg", lat: 53.5511, lon: 9.9937 },
      { name: "Cologne", lat: 50.9375, lon: 6.9603 },
    ],
  },
  ES: {
    name: "Spain",
    language: "es",
    cities: [
      { name: "Madrid", lat: 40.4168, lon: -3.7038 },
      { name: "Barcelona", lat: 41.3851, lon: 2.1734 },
      { name: "Seville", lat: 37.3891, lon: -5.9845 },
      { name: "Bilbao", lat: 43.263, lon: -2.935 },
    ],
  },
  PT: {
    name: "Portugal",
    language: "pt",
    cities: [
      { name: "Lisbon", lat: 38.7223, lon: -9.1393 },
      { name: "Porto", lat: 41.1579, lon: -8.6291 },
      { name: "Faro", lat: 37.0194, lon: -7.9304 },
    ],
  },
  IT: {
    name: "Italy",
    language: "it",
    cities: [
      { name: "Rome", lat: 41.9028, lon: 12.4964 },
      { name: "Milan", lat: 45.4642, lon: 9.19 },
      { name: "Naples", lat: 40.8518, lon: 14.2681 },
      { name: "Palermo", lat: 38.1157, lon: 13.3615 },
    ],
  },
  NL: {
    name: "Netherlands",
    language: "nl",
    cities: [
      { name: "Amsterdam", lat: 52.3676, lon: 4.9041 },
      { name: "Rotterdam", lat: 51.9244, lon: 4.4777 },
      { name: "Eindhoven", lat: 51.4416, lon: 5.4697 },
    ],
  },
  BE: {
    name: "Belgium",
    language: "fr",
    cities: [
      { name: "Brussels", lat: 50.8503, lon: 4.3517 },
      { name: "Antwerp", lat: 51.2194, lon: 4.4025 },
      { name: "Liège", lat: 50.6326, lon: 5.5797 },
    ],
  },
  CH: {
    name: "Switzerland",
    language: "de",
    cities: [
      { name: "Zurich", lat: 47.3769, lon: 8.5417 },
      { name: "Geneva", lat: 46.2044, lon: 6.1432 },
      { name: "Bern", lat: 46.948, lon: 7.4474 },
    ],
  },
  AT: {
    name: "Austria",
    language: "de",
    cities: [
      { name: "Vienna", lat: 48.2082, lon: 16.3738 },
      { name: "Salzburg", lat: 47.8095, lon: 13.055 },
      { name: "Innsbruck", lat: 47.2692, lon: 11.4041 },
    ],
  },
  SE: {
    name: "Sweden",
    language: "sv",
    cities: [
      { name: "Stockholm", lat: 59.3293, lon: 18.0686 },
      { name: "Gothenburg", lat: 57.7089, lon: 11.9746 },
      { name: "Malmö", lat: 55.605, lon: 13.0038 },
    ],
  },
  NO: {
    name: "Norway",
    language: "no",
    cities: [
      { name: "Oslo", lat: 59.9139, lon: 10.7522 },
      { name: "Bergen", lat: 60.3913, lon: 5.3221 },
      { name: "Tromsø", lat: 69.6492, lon: 18.9553 },
    ],
  },
  DK: {
    name: "Denmark",
    language: "da",
    cities: [
      { name: "Copenhagen", lat: 55.6761, lon: 12.5683 },
      { name: "Aarhus", lat: 56.1629, lon: 10.2039 },
    ],
  },
  FI: {
    name: "Finland",
    language: "fi",
    cities: [
      { name: "Helsinki", lat: 60.1699, lon: 24.9384 },
      { name: "Tampere", lat: 61.4978, lon: 23.761 },
      { name: "Rovaniemi", lat: 66.5039, lon: 25.7294 },
    ],
  },
  PL: {
    name: "Poland",
    language: "pl",
    cities: [
      { name: "Warsaw", lat: 52.2297, lon: 21.0122 },
      { name: "Kraków", lat: 50.0647, lon: 19.945 },
      { name: "Gdańsk", lat: 54.352, lon: 18.6466 },
    ],
  },
  CZ: {
    name: "Czechia",
    language: "cs",
    cities: [
      { name: "Prague", lat: 50.0755, lon: 14.4378 },
      { name: "Brno", lat: 49.1951, lon: 16.6068 },
    ],
  },
  GR: {
    name: "Greece",
    language: "el",
    cities: [
      { name: "Athens", lat: 37.9838, lon: 23.7275 },
      { name: "Thessaloniki", lat: 40.6401, lon: 22.9444 },
    ],
  },
  UA: {
    name: "Ukraine",
    language: "uk",
    cities: [
      { name: "Kyiv", lat: 50.4501, lon: 30.5234 },
      { name: "Lviv", lat: 49.8397, lon: 24.0297 },
      { name: "Odesa", lat: 46.4825, lon: 30.7233 },
    ],
  },
  RO: {
    name: "Romania",
    language: "ro",
    cities: [
      { name: "Bucharest", lat: 44.4268, lon: 26.1025 },
      { name: "Cluj-Napoca", lat: 46.7712, lon: 23.6236 },
    ],
  },
  IS: {
    // Capital-only: small, single-region population — a second city would
    // not meaningfully change the "national" read.
    name: "Iceland",
    language: "is",
    cities: [{ name: "Reykjavík", lat: 64.1466, lon: -21.9426 }],
  },

  // --- North America ---------------------------------------------------------
  US: {
    name: "United States",
    language: "en",
    cities: [
      { name: "Washington", lat: 38.9072, lon: -77.0369 },
      { name: "New York", lat: 40.7128, lon: -74.006 },
      { name: "Chicago", lat: 41.8781, lon: -87.6298 },
      { name: "Denver", lat: 39.7392, lon: -104.9903 },
      { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
    ],
  },
  CA: {
    name: "Canada",
    language: "en",
    cities: [
      { name: "Ottawa", lat: 45.4215, lon: -75.6972 },
      { name: "Toronto", lat: 43.6532, lon: -79.3832 },
      { name: "Vancouver", lat: 49.2827, lon: -123.1207 },
      { name: "Calgary", lat: 51.0447, lon: -114.0719 },
    ],
  },
  MX: {
    name: "Mexico",
    language: "es",
    cities: [
      { name: "Mexico City", lat: 19.4326, lon: -99.1332 },
      { name: "Guadalajara", lat: 20.6597, lon: -103.3496 },
      { name: "Monterrey", lat: 25.6866, lon: -100.3161 },
    ],
  },

  // --- South America -----------------------------------------------------
  BR: {
    name: "Brazil",
    language: "pt",
    cities: [
      { name: "Brasília", lat: -15.7939, lon: -47.8828 },
      { name: "São Paulo", lat: -23.5505, lon: -46.6333 },
      { name: "Rio de Janeiro", lat: -22.9068, lon: -43.1729 },
      { name: "Manaus", lat: -3.119, lon: -60.0217 },
    ],
  },
  AR: {
    name: "Argentina",
    language: "es",
    cities: [
      { name: "Buenos Aires", lat: -34.6037, lon: -58.3816 },
      { name: "Córdoba", lat: -31.4201, lon: -64.1888 },
      { name: "Mendoza", lat: -32.8895, lon: -68.8458 },
    ],
  },
  CL: {
    name: "Chile",
    language: "es",
    cities: [
      { name: "Santiago", lat: -33.4489, lon: -70.6693 },
      { name: "Antofagasta", lat: -23.6509, lon: -70.3975 },
      { name: "Punta Arenas", lat: -53.1638, lon: -70.9171 },
    ],
  },
  CO: {
    name: "Colombia",
    language: "es",
    cities: [
      { name: "Bogotá", lat: 4.711, lon: -74.0721 },
      { name: "Medellín", lat: 6.2442, lon: -75.5812 },
      { name: "Cartagena", lat: 10.391, lon: -75.4794 },
    ],
  },
  PE: {
    name: "Peru",
    language: "es",
    cities: [
      { name: "Lima", lat: -12.0464, lon: -77.0428 },
      { name: "Cusco", lat: -13.5319, lon: -71.9675 },
    ],
  },

  // --- Africa ------------------------------------------------------------
  ZA: {
    name: "South Africa",
    language: "en",
    cities: [
      { name: "Pretoria", lat: -25.7479, lon: 28.2293 },
      { name: "Cape Town", lat: -33.9249, lon: 18.4241 },
      { name: "Durban", lat: -29.8587, lon: 31.0218 },
    ],
  },
  NG: {
    name: "Nigeria",
    language: "en",
    cities: [
      { name: "Abuja", lat: 9.0765, lon: 7.3986 },
      { name: "Lagos", lat: 6.5244, lon: 3.3792 },
      { name: "Kano", lat: 12.0022, lon: 8.592 },
    ],
  },
  EG: {
    name: "Egypt",
    language: "ar",
    cities: [
      { name: "Cairo", lat: 30.0444, lon: 31.2357 },
      { name: "Alexandria", lat: 31.2001, lon: 29.9187 },
      { name: "Aswan", lat: 24.0889, lon: 32.8998 },
    ],
  },
  KE: {
    name: "Kenya",
    language: "en",
    cities: [
      { name: "Nairobi", lat: -1.2921, lon: 36.8219 },
      { name: "Mombasa", lat: -4.0435, lon: 39.6682 },
    ],
  },
  MA: {
    name: "Morocco",
    language: "ar",
    cities: [
      { name: "Rabat", lat: 34.0209, lon: -6.8416 },
      { name: "Casablanca", lat: 33.5731, lon: -7.5898 },
      { name: "Marrakesh", lat: 31.6295, lon: -7.9811 },
    ],
  },
  GH: {
    // Capital-only fallback — acceptable per the brief; still a strict
    // improvement over a mocked reading.
    name: "Ghana",
    language: "en",
    cities: [{ name: "Accra", lat: 5.6037, lon: -0.187 }],
  },

  // --- Middle East ---------------------------------------------------------
  IL: {
    name: "Israel",
    language: "he",
    cities: [
      { name: "Jerusalem", lat: 31.7683, lon: 35.2137 },
      { name: "Tel Aviv", lat: 32.0853, lon: 34.7818 },
    ],
  },
  TR: {
    name: "Turkey",
    language: "tr",
    cities: [
      { name: "Ankara", lat: 39.9334, lon: 32.8597 },
      { name: "Istanbul", lat: 41.0082, lon: 28.9784 },
      { name: "Izmir", lat: 38.4237, lon: 27.1428 },
    ],
  },
  AE: {
    name: "United Arab Emirates",
    language: "ar",
    cities: [
      { name: "Abu Dhabi", lat: 24.4539, lon: 54.3773 },
      { name: "Dubai", lat: 25.2048, lon: 55.2708 },
    ],
  },
  SA: {
    name: "Saudi Arabia",
    language: "ar",
    cities: [
      { name: "Riyadh", lat: 24.7136, lon: 46.6753 },
      { name: "Jeddah", lat: 21.4858, lon: 39.1925 },
    ],
  },

  // --- Asia ------------------------------------------------------------------
  IN: {
    name: "India",
    language: "en",
    cities: [
      { name: "New Delhi", lat: 28.6139, lon: 77.209 },
      { name: "Mumbai", lat: 19.076, lon: 72.8777 },
      { name: "Kolkata", lat: 22.5726, lon: 88.3639 },
      { name: "Bengaluru", lat: 12.9716, lon: 77.5946 },
    ],
  },
  CN: {
    name: "China",
    language: "zh",
    cities: [
      { name: "Beijing", lat: 39.9042, lon: 116.4074 },
      { name: "Shanghai", lat: 31.2304, lon: 121.4737 },
      { name: "Guangzhou", lat: 23.1291, lon: 113.2644 },
      { name: "Chengdu", lat: 30.5728, lon: 104.0668 },
    ],
  },
  JP: {
    name: "Japan",
    language: "ja",
    cities: [
      { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
      { name: "Osaka", lat: 34.6937, lon: 135.5023 },
      { name: "Sapporo", lat: 43.0618, lon: 141.3545 },
      { name: "Fukuoka", lat: 33.5904, lon: 130.4017 },
    ],
  },
  KR: {
    name: "South Korea",
    language: "ko",
    cities: [
      { name: "Seoul", lat: 37.5665, lon: 126.978 },
      { name: "Busan", lat: 35.1796, lon: 129.0756 },
    ],
  },
  ID: {
    name: "Indonesia",
    language: "id",
    cities: [
      { name: "Jakarta", lat: -6.2088, lon: 106.8456 },
      { name: "Surabaya", lat: -7.2575, lon: 112.7521 },
      { name: "Denpasar", lat: -8.6705, lon: 115.2126 },
    ],
  },
  TH: {
    name: "Thailand",
    language: "th",
    cities: [
      { name: "Bangkok", lat: 13.7563, lon: 100.5018 },
      { name: "Chiang Mai", lat: 18.7883, lon: 98.9853 },
    ],
  },
  VN: {
    name: "Vietnam",
    language: "vi",
    cities: [
      { name: "Hanoi", lat: 21.0278, lon: 105.8342 },
      { name: "Ho Chi Minh City", lat: 10.8231, lon: 106.6297 },
    ],
  },
  PH: {
    name: "Philippines",
    language: "en",
    cities: [
      { name: "Manila", lat: 14.5995, lon: 120.9842 },
      { name: "Davao City", lat: 7.1907, lon: 125.4553 },
    ],
  },
  PK: {
    name: "Pakistan",
    language: "en",
    cities: [
      { name: "Islamabad", lat: 33.6844, lon: 73.0479 },
      { name: "Karachi", lat: 24.8607, lon: 67.0011 },
      { name: "Lahore", lat: 31.5204, lon: 74.3587 },
    ],
  },
  SG: {
    // Capital-only / city-state — there is no "other region" to add.
    name: "Singapore",
    language: "en",
    cities: [{ name: "Singapore", lat: 1.3521, lon: 103.8198 }],
  },
  MY: {
    name: "Malaysia",
    language: "en",
    cities: [
      { name: "Kuala Lumpur", lat: 3.139, lon: 101.6869 },
      { name: "George Town", lat: 5.4141, lon: 100.3288 },
    ],
  },

  // --- Oceania ---------------------------------------------------------------
  AU: {
    name: "Australia",
    language: "en",
    cities: [
      { name: "Canberra", lat: -35.2809, lon: 149.13 },
      { name: "Sydney", lat: -33.8688, lon: 151.2093 },
      { name: "Melbourne", lat: -37.8136, lon: 144.9631 },
      { name: "Perth", lat: -31.9505, lon: 115.8605 },
      { name: "Darwin", lat: -12.4634, lon: 130.8456 },
    ],
  },
  NZ: {
    name: "New Zealand",
    language: "en",
    cities: [
      { name: "Wellington", lat: -41.2865, lon: 174.7762 },
      { name: "Auckland", lat: -36.8485, lon: 174.7633 },
      { name: "Christchurch", lat: -43.5321, lon: 172.6362 },
    ],
  },
};

/** The default country until `/settings` is used — matches `station_settings`
 *  table's own `DEFAULT 'GB'`. */
export const DEFAULT_COUNTRY = "GB";

/** Country info for a code, falling back to the default (GB) for an unknown
 *  or not-yet-covered code — so a bad/legacy value never breaks generation. */
export function countryInfoFor(code: string): CountryInfo {
  return COUNTRIES[code.toUpperCase()] ?? COUNTRIES[DEFAULT_COUNTRY]!;
}

/** `{code, name}` pairs sorted by name, for populating the `/settings`
 *  country `<select>`. */
export function countryOptions(): { code: string; name: string }[] {
  return Object.entries(COUNTRIES)
    .map(([code, info]) => ({ code, name: info.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
