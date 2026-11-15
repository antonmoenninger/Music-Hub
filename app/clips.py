"""Short MP3 clips of library songs for the Rewind soundtrack.

A clip is ~40 s from near the chorus, transcoded by Navidrome and cached as a plain file,
so phones get a small download that supports seeking (iOS Safari is picky about streams).
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

import httpx

from . import navidrome
from .config import settings

log = logging.getLogger("musichub.clips")
CLIP_SECONDS = 40
BITRATE = 160  # kbit/s
_http = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=5))
_locks: dict[str, asyncio.Lock] = {}


def _dir() -> Path:
    d = settings.data_dir / "clips"
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_for(song_id: str) -> Path:
    return _dir() / (re.sub(r"[^A-Za-z0-9_-]", "_", song_id) + ".mp3")


def start_offset(duration: int | float | None) -> int:
    """Skip the intro: ~30 % in, at most 75 s, none for short songs."""
    d = float(duration or 0)
    return int(min(d * 0.3, 75)) if d > 90 else 0


async def ensure(song_id: str, duration: int | float | None = None) -> Path | None:
    p = path_for(song_id)
    if p.exists() and p.stat().st_size > 20_000:
        return p
    lock = _locks.setdefault(song_id, asyncio.Lock())
    async with lock:
        if p.exists() and p.stat().st_size > 20_000:
            return p
        if duration is None:
            song = await navidrome.get_song(song_id)
            if not song:
                return None
            duration = song.get("duration")
        params = navidrome._auth(settings.nd_user, settings.nd_pass)
        params.pop("f")
        params.update({"id": song_id, "format": "mp3", "maxBitRate": BITRATE, "timeOffset": start_offset(duration)})
        want = BITRATE * 1000 // 8 * CLIP_SECONDS
        tmp = p.with_suffix(".part")
        got = 0
        try:
            async with _http.stream("GET", f"{settings.nd_url}/rest/stream", params=params) as r:
                if r.status_code != 200 or not r.headers.get("content-type", "").startswith("audio"):
                    log.warning("clip %s: navidrome answered %s %s", song_id, r.status_code, r.headers.get("content-type"))
                    return None
                with tmp.open("wb") as fh:
                    async for chunk in r.aiter_bytes(1 << 15):
                        fh.write(chunk)
                        got += len(chunk)
                        if got >= want:
                            break  # enough for one slide (and a long pause)
        except httpx.HTTPError as e:
            log.warning("clip %s: %s", song_id, e)
            tmp.unlink(missing_ok=True)
            return None
        if got < 20_000:
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(p)
        return p


async def prewarm(songs: list[dict]) -> None:
    """Prepare every soundtrack clip one after another (keeps the server's CPU calm)."""
    for s in songs:
        try:
            await ensure(s["nd_id"], s.get("duration"))
        except Exception as e:
            log.warning("prewarm %s: %s", s.get("nd_id"), e)
