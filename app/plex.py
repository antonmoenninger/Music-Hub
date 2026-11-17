"""Pull music plays from Plex's watch history, and match songs to Navidrome."""
from __future__ import annotations

import asyncio
import logging

import httpx

from . import db, navidrome
from .config import settings

log = logging.getLogger("musichub.plex")
_http = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5))
PAGE = 500


async def _history(start: int, size: int) -> dict:
    r = await _http.get(
        f"{settings.plex_url}/status/sessions/history/all",
        params={"librarySectionID": settings.plex_section, "sort": "viewedAt:desc",
                "X-Plex-Container-Start": start, "X-Plex-Container-Size": size,
                "X-Plex-Token": settings.plex_token},
        headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()["MediaContainer"]


async def sync_once() -> int:
    """Newest-first walk until we reach plays we already have. First run backfills everything."""
    last = int(db.kv_get("plex_last_viewed", "0") or 0)
    newest = last
    added = 0
    start = 0
    while True:
        mc = await _history(start, PAGE)
        items = mc.get("Metadata") or []
        if not items:
            break
        reached_known = False
        for it in items:
            ts = int(it.get("viewedAt") or 0)
            if ts <= last:
                reached_known = True
                break
            newest = max(newest, ts)
            if it.get("type") != "track":
                continue
            account = str(it.get("accountID") or "")
            user = db.plex_user(account)  # unlinked accounts are kept as "plex:<id>" until linked
            artist = it.get("originalTitle") or it.get("grandparentTitle") or ""
            dur = it.get("duration")
            if db.add_play("plex", user, ts, artist, it.get("parentTitle") or "", it.get("title") or "",
                           int(dur) // 1000 if dur else None, str(it.get("ratingKey") or ""), account):
                added += 1
        if reached_known or len(items) < PAGE:
            break
        start += PAGE
        await asyncio.sleep(0.2)
    if newest > last:
        db.kv_set("plex_last_viewed", newest)
    return added


async def scan_folder(rel_folder: str) -> None:
    """Ask Plex to scan one downloaded folder (partial scan), so new music shows up right away."""
    if not settings.plex_enabled or not settings.plex_download_path:
        return
    path = f"{settings.plex_download_path}/{rel_folder.strip('/')}"
    try:
        r = await _http.get(f"{settings.plex_url}/library/sections/{settings.plex_section}/refresh",
                            params={"path": path, "X-Plex-Token": settings.plex_token})
        r.raise_for_status()
        log.info("Plex scan queued for %s", path)
    except httpx.HTTPError as e:
        log.warning("Plex scan for %s failed: %s", path, e)


async def accounts() -> list[dict]:
    """Plex accounts of this server (id + name)."""
    r = await _http.get(f"{settings.plex_url}/accounts", params={"X-Plex-Token": settings.plex_token},
                        headers={"Accept": "application/json"})
    r.raise_for_status()
    out = [{"account": str(a["id"]), "name": (a.get("name") or "").strip()} for a in r.json()["MediaContainer"].get("Account", [])]
    for a in out:
        db.ex("INSERT INTO plex_links(account, plex_name) VALUES(?,?) ON CONFLICT(account) DO UPDATE SET plex_name=excluded.plex_name",
              (a["account"], a["name"]))
    return out


async def plex_loop() -> None:
    if not settings.plex_enabled:
        log.info("Plex not configured, skipping")
        return
    try:
        await accounts()
    except Exception as e:
        log.warning("plex accounts: %s", e)
    while True:
        try:
            n = await sync_once()
            if n:
                log.info("plex: %d new plays", n)
        except Exception as e:
            log.warning("plex sync failed: %s", e)
        await asyncio.sleep(settings.plex_poll_seconds)


# ------------------------------------------------------------- enrichment
def _best(song_list: list[dict], key: str) -> dict | None:
    for s in song_list:
        if db.track_key(s.get("artist", ""), s.get("title", "")) == key:
            return s
    for s in song_list:  # album-artist credited differently
        if db.track_key(s.get("displayAlbumArtist") or s.get("albumArtist") or "", s.get("title", "")) == key:
            return s
    return None


def _best_various(song_list: list[dict], title: str, album: str) -> dict | None:
    """Compilation tracks: Plex only knows "Various Artists", so match on title (+ album)."""
    hits = [s for s in song_list if db.norm(s.get("title", "")) == db.norm(title)]
    for s in hits:
        if album and db.norm(s.get("album", "")) == db.norm(album):
            return s
    return hits[0] if len(hits) == 1 else None


async def enrich_once(batch: int = 200) -> int:
    rows = db.q("SELECT track_key, artist, title, album FROM tracks WHERE resolved=0 LIMIT ?", (batch,))
    for r in rows:
        various = db.is_various(r["artist"])
        try:
            if various:
                res = await navidrome.search(r["title"], songs=25, albums=0, artists=0)
                s = _best_various(res.get("song") or [], r["title"], r["album"] or "")
            else:
                res = await navidrome.search(f"{db.primary_artist(r['artist'])} {r['title']}", songs=10, albums=0, artists=0)
                s = _best(res.get("song") or [], r["track_key"])
                if not s:  # retry on the title alone, artist strings differ a lot between taggers
                    res = await navidrome.search(r["title"], songs=25, albums=0, artists=0)
                    s = _best(res.get("song") or [], r["track_key"])
        except Exception as e:
            log.warning("enrich %s: %s", r["track_key"], e)
            return 0
        if s:
            db.ex("UPDATE tracks SET nd_id=?, album_id=?, artist_id=?, genre=?, duration=COALESCE(?, duration), "
                  "year=?, album=COALESCE(NULLIF(album,''), ?), artist=?, resolved=1 WHERE track_key=?",
                  (s.get("id"), s.get("albumId"), s.get("artistId"), s.get("genre"), s.get("duration"),
                   s.get("year"), s.get("album"), s.get("artist") if various else r["artist"], r["track_key"]))
        else:
            db.ex("UPDATE tracks SET resolved=2 WHERE track_key=?", (r["track_key"],))
        await asyncio.sleep(0.03)
    return len(rows)


async def enrich_loop() -> None:
    while True:
        try:
            n = await enrich_once()
        except Exception as e:
            log.warning("enrich failed: %s", e)
            n = 0
        await asyncio.sleep(1 if n else 60)
