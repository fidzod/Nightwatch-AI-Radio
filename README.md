# Nightwatch Radio

A personal internet radio station that runs itself. Four AI presenters,
Cassius Thorne, Thaddeus Crake, Lucan Wormhald, and Leander Rook, take
shifts through the day, introducing songs, reading the news and weather,
handing off between collections, and signing off. The scripts are written
live by Claude and spoken by ElevenLabs. Music crossfades under LiquidSoap,
there's an ambient static/crackle effect layered over everything, and the
whole thing streams out over Icecast to a CRT-styled console I built for it.

![Nightwatch Radio station console](screenshot.png)

## Architecture

```
liquidsoap/           playback engine (LiquidSoap scripts)
  radio.liq              pull (music) + push (AI speech) graph, crossfade,
                          dual output (local monitor + Icecast)
  static_fx.liq           ambient static/fuzz effect, layered on the
                          combined output

apps/engine/           the station's "brain," a long-running Node process
  src/scheduler/          resolves who's on air from the DB, rolls the
                          7-moment-type trigger rules, pre-renders ahead
                          of air time, writes live status
  src/generation/         Claude (script) + ElevenLabs Flash (voice)
  src/providers/          mock news/weather, swappable for real APIs later
  src/server.ts            HTTP: /next-music (LiquidSoap pulls from this),
                          /trigger/<type>, /schedule/now, /health

apps/web/               SvelteKit station console (CRT/retro UI)
  routes/live              on-air HUD, embeds the Icecast stream
  routes/collections       playlist CRUD + mp3 upload (ffprobe duration,
                          ID3 tags, sha256 dedupe)
  routes/presenters        persona CRUD (name, system prompt, voice ID)
  routes/schedule           weekly / date-override schedule_slots CRUD

packages/db/             shared SQLite schema (node:sqlite), used by both
                        apps/engine and apps/web. The database is the only
                        source of truth for presenters and schedule; the
                        engine re-reads it fresh every scheduler tick, so
                        edits made in the UI take effect on the next clip

audio/library/<name>/   uploaded mp3s, one directory per collection
audio/generated/        cached TTS clips (logged in generated_clips)
data/airadio.sqlite3    the database
```

Here's how a line actually gets on air. The engine decides a moment should
happen (hourly, on a collection change, or a probabilistic roll between
songs) and writes a `generated_clips` row. It asks Claude for a script in
the active presenter's voice, asks ElevenLabs Flash to render it, and once
the file's ready, pushes it into LiquidSoap's `inject` queue over telnet.

LiquidSoap combines that push-based speech queue with a pull-based music
source (it calls back into `/next-music` whenever it needs a new track)
through `fallback(track_sensitive=false, ...)`. Crossfade is applied to each
source individually, before they're combined, not after on the combined
result. That ordering matters: there's a known LiquidSoap issue where
crossfading breaks once a `request.queue` item has played through a
`fallback`, and doing it per-source before combining is the workaround.
`track_sensitive=false` is what lets a pushed clip land at the next track
boundary without interrupting a crossfade already in progress. The static
effect wraps the combined output last, so it has no idea whether it's
riding over music or speech. It doesn't need to care.

## How it works

### Dev environment

A Nix flake (`flake.nix`) pulls in LiquidSoap, Icecast, Node 22, pnpm,
sqlite, and ffmpeg. `nix develop` is the only prerequisite. No manual
installs.

### Database

SQLite through Node's built-in `node:sqlite`, so there's nothing native to
compile. The core tables are `presenters`, `collections`, `tracks`,
`schedule_slots`, and `generated_clips` (the TTS cache, with a status
lifecycle of `pending → rendering → ready → used`/`failed`). `station_state`
is a singleton row the live UI polls. `news_items` and `weather_snapshots`
are mock data behind a `NewsProvider`/`WeatherProvider` interface, so wiring
up a real API later is a swap, not a rewrite.

### Scheduling

`schedule_slots` rows are either `weekly` (day of week + time range) or
`date_override` (a specific date, which wins over weekly). A 5-second
scheduler tick resolves who's on air, notices presenter or collection
changes, and fires one of seven moment types: song intro, collection
changeover, top-of-hour open, news, weather, sign-off, and filler
one-liners. Priority order is sign-off, then changeover, then the
hour/news/weather triad, then the probabilistic intro/filler rolls. A
higher-priority deterministic trigger always preempts a lower one, so clips
never stack. Everything is pre-rendered ahead of its delivery deadline, so
there's no dead air waiting on an API call.

### AI

Claude writes every script from a per-presenter system prompt plus a
trigger-specific template (time, collection and song metadata, or raw
news/weather data to relay more or less verbatim). ElevenLabs Flash renders
the audio. Each presenter's voice was picked by hand in the ElevenLabs
dashboard and the ID is stored in `presenters.elevenlabs_voice_id`.

### No streaming infra beyond Icecast

This runs on one machine for one listener. LiquidSoap's output stage is
additive, so bolting on a remote relay later wouldn't take much, but it
isn't there now.

## Usage

```sh
nix develop                              # everything below assumes this shell

cp .env.example .env                     # fill in ANTHROPIC_API_KEY,
                                         # ELEVENLABS_API_KEY, ICECAST_SOURCE_PASSWORD
pnpm install

scripts/start-icecast.sh &               # local Icecast, config is generated
liquidsoap liquidsoap/radio.liq &        # playback engine
pnpm --filter @airadio/engine start &    # scheduler + AI pipeline
pnpm --filter @airadio/web dev           # station console, http://localhost:5173
```

Tune in at `http://localhost:8000/nightwatch.mp3`, or open `/live` in the
console, which embeds the stream directly. Upload music and edit
presenters/schedule from `/collections`, `/presenters`, and `/schedule`.
Changes take effect on the next scheduler tick, no restart needed.

## How I built this

I built this conversationally with Claude Code, start to finish, and the
process is worth writing down because it shaped the result almost as much
as any single design decision did.

The initial ask was broad: AI DJs, a melancholic resistance-radio vibe,
LiquidSoap, a schedule, an upload interface. That's too broad to start
coding against, so the first pass was planning mode: real decisions made
before any file existed. SvelteKit or a native GPUI app. Mock or real
news/weather for v1. How many presenters to design up front. Whether the
static effect should be a transition-only sting or something ambient. Each
of those went through a proposal with a recommendation attached rather than
a guess, backed by actual research into how LiquidSoap's request queue and
crossfade semantics behave (not just what seemed plausible).

The UI came from references, not a brief. I dropped eleven images into
`ui-reference-images/`: a deep-space tracking HUD, a DOS-era terminal, a
cassette J-card, old weather broadcast graphics, with no further
explanation. Those got read as images, turned into a design language
(numbers-station, listening-post, cassette-left-in-a-drawer), mapped onto
actual UI regions, and checked against me before `apps/web` got scaffolded.

Verification was empirical, not assumed. Claims about audio behavior got
checked by capturing the real Icecast stream with `ffmpeg` and running it
through `astats`, `silencedetect`, and `volumedetect`, because an agent
can't listen to a stream, so "it compiles" never counted as "it works."
That process caught a real bug: the static effect's internal clock was
drifting behind wall-clock time under load, found by noticing a measured
gap exceeded its configured maximum, fixed by switching to real elapsed-time
measurement instead of assuming a fixed tick duration. It also disproved a
suspected one: a feared crossfade-after-queue-push regression that turned
out not to be happening, confirmed by analyzing 24 crossfade events around
live injections.

Work went parallel once it was safe to. Phases ran sequentially up through
the database schema (scaffolding, then the LiquidSoap baseline, then the
schema), and only after that did the engine's AI pipeline and the SvelteKit
UI get built at the same time by two background agents, both of which only
depended on the now-stable schema, not on each other. Each got verified on
its own terms: the engine against live stream capture, the UI against the
reference images and an actual upload run end to end. The full scheduler
followed the same pattern once presenters and schedule existed to resolve
against, and it got proven against a simulated compressed broadcast day (27
of 27 checks passing) plus live delivery of all seven moment types.

Iteration stayed conversational after the architecture settled. Presenter
voices got picked by generating in-character sample lines and auditioning
them in ElevenLabs directly. Renames and a fourth, daytime-only presenter
got added without re-planning anything. The static effect got redesigned
twice off nothing but listening feedback: "sounds like rain," and later
"crackle is sounding great." One schedule bug (only one of seven weekly
day-rows had actually been updated after a UI edit) got caught by looking
directly at the database instead of taking "it's working" at face value.

PRs welcome.
