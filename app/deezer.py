"""Deezer's public search API: the fallback when Spotify search (via SpotBye) is unavailable.

Results use the same shape as SpotBye's Spotify search; ids are "deezer:<n>" so the
downloader hands SpotBye a Deezer link (its "Direct" mode) instead of a Spotify one.
"""
from __future__ import annotations

import asyncio

import httpx

_http = httpx.AsyncClient(base_url="https://api.deezer.com", timeout=httpx.Timeout(15, connect=6))
PREFIX = "deezer:"


def url(kind: str, ref: str) -> str:
    return f"https://www.deezer.com/{kind}/{ref.removeprefix(PREFIX)}"


async def _get(path: str, **params) -> list[dict]:
    r = await _http.get(path, params=params)
    r.raise_for_status()
    body = r.json()
    if "error" in body:
        raise httpx.HTTPError(f"Deezer: {body['error'].get('message', body['error'])}")
    return body.get("data") or []


async def search(q: str, limit: int = 12) -> dict:
    tracks, albums = await asyncio.gather(_get("/search/track", q=q, limit=limit),
                                          _get("/search/album", q=q, limit=limit))
    return {
        "tracks": [{
            "spotify_id": f"{PREFIX}{t['id']}",
            "name": t.get("title") or "",
            "artists": (t.get("artist") or {}).get("name", ""),
            "album_name": (t.get("album") or {}).get("title", ""),
            "images": (t.get("album") or {}).get("cover_medium", ""),
            "duration_ms": int(t.get("duration") or 0) * 1000,
            "explicit": bool(t.get("explicit_lyrics")),
        } for t in tracks],
        "albums": [{
            "id": f"{PREFIX}{a['id']}",
            "name": a.get("title") or "",
            "artists": (a.get("artist") or {}).get("name", ""),
            "total_tracks": a.get("nb_tracks"),
            "images": a.get("cover_medium", ""),
        } for a in albums],
    }
