# Music Hub

Self-hosted companion for Navidrome + Plex:

- **Search**: your Navidrome library and Spotify side by side; one click downloads a
  Spotify track or album through SpotBye into `/media/Plex/Musik-downloads/<Artist>/<Album>/`.
- **Subsonic proxy**: point any Subsonic app (Wavio, Psysonic, …) at the Hub instead of
  Navidrome. Search results get Spotify tracks appended (album shows `· Spotify`); playing
  one downloads it first (~30–40 s), then streams it.
- **Statistics**: Navidrome and Plex plays combined (top artists/songs/albums/genres,
  time of day, weekday, daily minutes).
- **Rewind**: a full-screen story of your year (portrait + landscape layouts), with songs from
  the library crossfading behind the slides, a musical age, share images (9:16 / 16:9) and
  public read-only share links (`/r/<token>`, no music, only that Rewind's covers).

Web UI: React + Vite + Tailwind + shadcn/ui in `frontend/` (built into `static/` by the
Dockerfile; `npm run dev` proxies `/api` to a local Hub on :8095). Rewind colours live in
`frontend/src/rewind/themes.ts`.

## Pieces

| Part | Where |
|---|---|
| Hub (FastAPI, `app/`, web UI in `frontend/`) | Portainer stack `musichub` on hpelitedesk, port 8095 |
| Navidrome plugin `Music Hub Sync` (`plugin/`) | `/DATA/AppData/navidrome/plugins/musichub.ndp` |
| Downloads | `/media/Plex/Musik-downloads` → Navidrome `/music/Musik-downloads` (read-only) |
| Data (SQLite) | `/DATA/AppData/musichub/musichub.db` |

How data flows:

- Plex plays: the Hub polls Plex's history every 2 min (`PLEX_USER_MAP` maps Plex account ids to Navidrome users).
- Navidrome plays: the plugin reads each user's scrobble history every minute and POSTs it to `/api/ingest/navidrome`.
- Songs are matched to Navidrome tracks in the background for covers, genres and durations.
- Scans need a Navidrome admin, so the Hub queues folders and the plugin (which has an admin user assigned) runs a targeted `startScan`.

## Deploy / update

```bash
rsync -a --delete --exclude .git --exclude plugin/.pdk --exclude frontend/node_modules --exclude static ./ anton@192.168.178.56:musichub-src/
ssh anton@192.168.178.56 'cd ~/musichub-src && docker build -t musichub:X.Y.Z .'
# then set MUSICHUB_VERSION=X.Y.Z in the Portainer stack env and update the stack
```

Plugin: `plugin/build.sh` → copy `plugin/musichub.ndp` to the Navidrome plugins folder, then
`navidrome plugin edit musichub --all-users --config '{"hubUrl":"http://musichub:8095","secret":"…"}'`
and `navidrome plugin enable musichub` (restart Navidrome to load changes made via the CLI).

Secrets (stack env): `ND_PASS` (Navidrome user `musichub`, non-admin), `SPOTBYE_KEY`,
`PLEX_TOKEN`, `INGEST_SECRET` (same value as the plugin's `secret`), `SESSION_SECRET`.
