"""Small Subsonic client for Navidrome (service account + per-user credential checks)."""
from __future__ import annotations

import hashlib
import json
import secrets
import time

import httpx

from .config import settings
from . import db

CLIENT = "musichub"
_http = httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5))


class NavidromeError(Exception):
    pass


def _auth(user: str, password: str) -> dict:
    salt = secrets.token_hex(6)
    return {"u": user, "t": hashlib.md5((password + salt).encode()).hexdigest(), "s": salt,
            "v": "1.16.1", "c": CLIENT, "f": "json"}


async def call(endpoint: str, user: str | None = None, password: str | None = None, **params) -> dict:
    p = _auth(user or settings.nd_user, password or settings.nd_pass)
    p.update({k: v for k, v in params.items() if v is not None})
    r = await _http.get(f"{settings.nd_url}/rest/{endpoint}", params=p)
    r.raise_for_status()
    body = r.json().get("subsonic-response", {})
    if body.get("status") != "ok":
        raise NavidromeError((body.get("error") or {}).get("message", "navidrome error"))
    return body


async def raw(endpoint: str, **params) -> httpx.Response:
    p = _auth(settings.nd_user, settings.nd_pass)
    p.pop("f")
    p.update({k: v for k, v in params.items() if v is not None})
    return await _http.get(f"{settings.nd_url}/rest/{endpoint}", params=p)


async def check_login(user: str, password: str) -> bool:
    try:
        await call("ping", user=user, password=password)
        return True
    except (NavidromeError, httpx.HTTPError):
        return False


async def search(query: str, songs: int = 20, albums: int = 8, artists: int = 5) -> dict:
    b = await call("search3", query=query, songCount=songs, albumCount=albums, artistCount=artists)
    return b.get("searchResult3") or {}


async def get_song(song_id: str) -> dict | None:
    row = db.q1("SELECT data FROM nd_songs WHERE id=?", (song_id,))
    if row:
        return json.loads(row["data"])
    try:
        song = (await call("getSong", id=song_id)).get("song")
    except NavidromeError:
        return None
    if song:
        db.ex("INSERT OR REPLACE INTO nd_songs(id,data) VALUES(?,?)", (song_id, json.dumps(song)))
    return song


_artist_cache: dict[str, tuple[float, str | None]] = {}


async def artist_id(name: str) -> str | None:
    hit = _artist_cache.get(name.lower())
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    res = await search(name, songs=0, albums=0, artists=3)
    aid = None
    for a in res.get("artist") or []:
        if db.norm(a.get("name", "")) == db.norm(name):
            aid = a["id"]
            break
    _artist_cache[name.lower()] = (time.time(), aid)
    return aid
