#!/usr/bin/env liquidsoap

## Nightwatch Radio — Phase 2
##
## Two sources, combined:
##
##   PULL (music)  `request.dynamic(next_music)` — LiquidSoap calls back into
##                 the engine's GET /next-music exactly when it needs another
##                 track. Because the engine resolves the collection on every
##                 call, schedule-driven collection changeover (Phase 3) falls
##                 out for free: no "reload playlist" signal is ever needed.
##
##   PUSH (speech) `request.queue(id="inject")` — the engine pushes a
##                 *pre-rendered* clip in over telnet (`inject.push <path>`)
##                 once it's ready. `interactive` defaults to true, which is
##                 what registers that telnet command.
##
## Combined with `fallback(track_sensitive=false, ...)`. The
## `track_sensitive=false` is load-bearing: it lets a pushed clip be picked up
## at the next track boundary without ever interrupting an in-progress
## crossfade.
##
## IMPORTANT — crossfade placement. There is a documented LiquidSoap issue
## where crossfading breaks *after* a `request.queue` item plays through a
## `fallback`. The mitigation, and the reason the graph is shaped this way, is
## to apply `crossfade` to each leaf source INDIVIDUALLY *before* combining
## them. Do not "simplify" this to `crossfade(fallback([...]))` — that is the
## broken pattern.
##
## The static/fuzz layer then wraps the final combined source, so it doesn't
## know or care whether music or speech is currently playing.

%include "static_fx.liq"

settings.log.stdout := true
settings.server.telnet := true
settings.server.telnet.port := 1234
settings.server.telnet.bind_addr := "127.0.0.1"

# --- configuration -----------------------------------------------------------
# Read from the environment so this file holds no secrets and no duplicated
# port numbers. Defaults match .env.example, so it runs with an empty env.

def env_or(name, default_value) =
  value = environment.get(name)
  if value == "" then default_value else value end
end

engine_port = env_or("ENGINE_HTTP_PORT", "7777")
next_music_url = "http://127.0.0.1:#{engine_port}/next-music"

icecast_password = env_or("ICECAST_SOURCE_PASSWORD", "hackme")
icecast_port = int_of_string(env_or("ICECAST_PORT", "8000"))

# Local monitor output needs a real sound card; set AIRADIO_MONITOR=0 for
# headless runs (CI, automated stream-continuity tests) so a missing ALSA
# device can't take the Icecast output down with it.
monitor_enabled = env_or("AIRADIO_MONITOR", "1") != "0"

# --- pull side: music from the engine ----------------------------------------

# Returns a request for the next music track, or `null` to make
# `request.dynamic` retry after `retry_delay`. Returning null (rather than
# raising) is what makes a dead engine degrade gracefully: the stream falls
# through to silence via `mksafe` and recovers by itself once the engine is
# back, with no LiquidSoap restart.
def next_music() =
  try
    response = http.get(timeout=5., next_music_url)
    if response.status_code == 200 then
      # Field is named `uri` rather than `path` because `path` would shadow
      # LiquidSoap's stdlib `path` module here.
      let json.parse ( { uri } : { uri : string } ) = response
      log.info(label="next_music", "engine returned #{uri}")
      request.create(uri)
    else
      log.important(
        label="next_music",
        "engine returned HTTP #{response.status_code} — retrying"
      )
      null
    end
  catch err do
    log.important(
      label="next_music",
      "could not reach engine at #{next_music_url}: #{err} — retrying"
    )
    null
  end
end

music = request.dynamic(id="music", retry_delay=5., next_music)

# --- push side: AI speech clips ----------------------------------------------

inject = request.queue(id="inject")

# --- combine -----------------------------------------------------------------
# crossfade per leaf, THEN fallback (see the note at the top of this file).

program =
  fallback(
    id="program",
    track_sensitive=false,
    [
      # Speech clips are back-to-back, independently-rendered files, not a
      # continuous musical bed — a music-style blend overlaps the end of one
      # clip with the start of the next, cutting both short. Near-zero
      # duration/fade_in/fade_out gives a clean cut instead.
      crossfade(id="inject_xfade", duration=0.2, fade_in=0.05, fade_out=0.05, inject),
      crossfade(id="music_xfade", music)
    ]
  )

# Both leaves are fallible (the engine may be down, the inject queue is empty
# most of the time), so make the graph infallible before the outputs: silence
# is a graceful degradation, a dead output is not.
program = mksafe(program)

program = apply_static_fx(program)

# --- outputs -----------------------------------------------------------------

if monitor_enabled then
  output.alsa(id="monitor", program)
else
  log.important(label="monitor", "AIRADIO_MONITOR=0 — local ALSA output disabled")
end

output.icecast(
  %mp3,
  id="icecast",
  host="localhost",
  port=icecast_port,
  password=icecast_password,
  mount="nightwatch.mp3",
  name="Nightwatch Radio",
  description="Late-night independent radio.",
  genre="Ambient / Melancholic",
  program
)
