# Nightwatch Radio

Nightwatch Radio is a personal internet radio station that plays your music. AI
presenters take shifts: introducing songs, reading news and weather, and handing
off between collections. You tune their names, personality, and voices. Scripts
are written live by Claude and spoken by ElevenLabs.

![Nightwatch Radio station console](screenshot.png)

## Running it

Dependencies: LiquidSoap, Icecast, Node 22+, pnpm, sqlite, ffmpeg.

```sh
nix develop   # or install the dependencies above yourself
cp .env.example .env
pnpm install
scripts/start-all.sh
```

Stream: `http://localhost:8000/nightwatch.mp3`. Console: `http://localhost:5173`,
with `/collections`, `/presenters`, `/schedule`, and `/settings` for editing
the station while it runs. Changes apply on the next scheduler tick.

## Architecture

- **`liquidsoap/`**: the playback graph. Crossfades music pulled from the
  engine with speech pushed in from it, layers an ambient static effect
  over the combined output, and streams the result to Icecast.
- **`apps/engine/`**: a long-running Node process. A scheduler resolves
  who's on air from the database and fires scripted "moments" (song
  intros, news, weather, hour opens, sign-offs); Claude writes each
  script, ElevenLabs renders it, and clips are pre-rendered ahead of their
  air time so there's never dead air waiting on an API call.
- **`apps/web/`**: the SvelteKit station console. A live on-air view, CRUD
  for collections (with mp3 upload), presenters, and the weekly schedule,
  and station settings (country, for news/weather).
- **`packages/db/`**: a shared SQLite schema (`node:sqlite`, nothing
  native to compile) that both apps read from. The database is the only
  source of truth: the engine re-reads it every tick, so edits made in
  the UI take effect immediately.

News comes from Google News RSS and weather from Open-Meteo, both free and
keyless, scoped to the country set in `/settings` (default UK). There's no
streaming infra beyond Icecast (this is built for one machine, one
listener), though LiquidSoap's output stage would make a remote relay easy
to add.

## Testing

`apps/engine/src/test/simulateDay.ts` drives the real scheduler through a full
broadcast day compressed into a few seconds. The scheduler takes an injectable
clock, and probabilistic triggers (song intros, filler clips) use a seeded PRNG,
so every run is deterministic and assertable. Only the paid APIs (Claude,
ElevenLabs) and LiquidSoap's telnet socket are stubbed; everything else,
including SQLite, is real.

The fixture is deliberately adversarial: four scheduled slots across the
evening, including one with no actual handoff, plus decoy slots (a disabled slot
at top priority, a weekly slot underneath the evening) to prove the resolver
ignores what it should. Around twenty assertions cover slot resolution,
hour-open → news → weather ordering, changeover clips, minimum gaps between
segments, and trigger rates and cooldowns.

## AI Usage

Built largely with Claude Code. I directed development throughout, and the
architecture was designed collaboratively: the split between playback, engine
and console, the database as single source of truth, and pre-rendering clips to
avoid dead air. Claude wrote most of the implementation.

Claude verified its own work two ways: running the simulated-day suite as a
regression gate after each change, and capturing the Icecast stream for analysis
with ffmpeg's astats, silencedetect and volumedetect, which caught a clock-drift
bug in the static effect, among other things.

