# @airadio/web — Nightwatch Radio station console

SvelteKit app (Svelte 5 runes, SvelteKit 3) for running the station: collections
and mp3 ingest, presenter dossiers, the programme schedule, and the live "on air"
HUD with the Icecast player embedded.

## Running

```sh
nix develop                        # from the repo root
pnpm --filter @airadio/web dev     # http://localhost:5173
```

`/` redirects to `/live`. The app talks to the same SQLite file as the engine
(`data/airadio.sqlite3`) via `@airadio/db`; there is no RPC between them.

## Routes

| route               | what it does                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `/live`             | SPCNET-style HUD over `station_state`, polling `/api/live` every 4s, plus the `<audio>` receiver pointed at `http://localhost:8000/nightwatch.mp3` |
| `/collections`      | tape shelf — every collection as a cassette J-card                       |
| `/collections/[id]` | the insert: tracklist (side A/B), audio ingest, per-track + collection edit, delete |
| `/presenters`       | operator roster — persona dossiers, DOS-terminal edit forms              |
| `/schedule`         | tabbed index-card filing of `schedule_slots` (weekly + date overrides)   |
| `/api/live`         | JSON snapshot used by the live view's poll                               |

## Server-side notes

- `src/lib/server/` is server-only by SvelteKit convention — the `node:sqlite`
  handle can never be bundled into client code.
- `src/lib/server/paths.ts` resolves the **monorepo root** by walking up to
  `pnpm-workspace.yaml` (override with `AIRADIO_ROOT`), so uploads land in
  `<repo>/audio/library/<collection-slug>/`, not under `apps/web`.
- Uploads are probed with `ffprobe` (duration + ID3 title/artist), sha256-
  deduped per collection, and stored with **absolute** `file_path`s — the same
  convention the engine hands to LiquidSoap.
- `src/lib/server/seed.ts` seeds the four personas (Cassius/Thaddeus/Lucan/
  Leander) and one weekly slot per persona, but only on a genuinely empty
  table — once any presenter exists, seeding never runs again, so renaming or
  deleting one sticks. It's also safe to race against the engine seeding the
  same tables. Importing loose
  files from `audio/library/` happens only when `collections` is completely
  empty, so deleting a collection in the UI doesn't resurrect it on restart.

## Deploying (not used in v1)

The build uses `@sveltejs/adapter-node`. If you ever run the built server rather
than `vite dev`, raise the upload limit — adapter-node caps request bodies at
512K by default:

```sh
BODY_SIZE_LIMIT=1G node build
```

`vite dev` applies no such cap.

## Design language

Hand-rolled CSS only (`src/lib/styles/app.css` + per-component styles); no
component kit. Palette, type and texture live in custom properties there, and
`src/lib/components/ScanlineOverlay.svelte` is the shared CRT treatment. Fonts
(JetBrains Mono, VT323) are self-hosted in `static/fonts/`.
