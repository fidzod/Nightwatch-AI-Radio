#!/usr/bin/env liquidsoap

## Nightwatch Radio — Phase 1
##
## Directory-based playlist, crossfaded, with the ambient static/fuzz effect
## applied, output both locally (for monitoring on the dev machine) and to a
## local Icecast mount (the real "listen live" path — this is what the
## SvelteKit UI's live view embeds, and what any other device on the LAN can
## tune into with a plain mp3-stream URL).
##
## No AI/engine involvement yet — Phase 2 replaces the `playlist()` call
## below with a `request.dynamic` source pulling from the engine's
## `/next-music` endpoint, and adds the `request.queue`-based `inject`
## source for AI-generated speech, combined via
## `fallback(track_sensitive=false, [inject, music])`. Telnet is enabled
## here already so that wiring is a pure addition later, not a rewrite.

%include "static_fx.liq"

settings.log.stdout := true
settings.server.telnet := true
settings.server.telnet.port := 1234
settings.server.telnet.bind_addr := "127.0.0.1"

library_dir = "audio/library/test-collection/"

music = playlist(id="music", mode="randomize", library_dir)
music = crossfade(music)

program = apply_static_fx(music)

# Local monitor output — useful when running directly on a desktop with a
# real sound card. Marked fallible-tolerant: if no ALSA device is available
# (e.g. a headless/sandboxed run), this output alone failing should not be
# allowed to take down the Icecast output below.
output.alsa(id="monitor", program)

output.icecast(
  %mp3,
  id="icecast",
  host="localhost",
  port=8000,
  password="hackme", # placeholder — replace with ICECAST_SOURCE_PASSWORD from .env
  mount="nightwatch.mp3",
  name="Nightwatch Radio",
  description="Late-night independent radio.",
  genre="Ambient / Melancholic",
  program
)
