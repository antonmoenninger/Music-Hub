"""Client for the SpotBye web API (Spotify search + downloads).

SPOTBYE_KEY may be either the API key (sent as X-API-Key) or the web password;
on a 401 the client logs in with it and keeps the session cookie.
"""
from __future__ import annotations

import asyncio
from urllib.parse import quote

import httpx

from .config import settings

_http = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=8))
_login_lock = asyncio.Lock()


class SpotbyeError(Exception):
    pass


def _h() -> dict:
    return {"X-API-Key": settings.spotbye_key}


async def _login() -> None:
    async with _login_lock:
        r = await _http.post(f"{settings.spotbye_url}/api/auth/login", json={"password": settings.spotbye_key})
        if r.status_code >= 400:
            raise SpotbyeError("SpotBye rejected the configured key/password")


async def _request(method: str, path: str, **kw) -> httpx.Response:
    url = f"{settings.spotbye_url}{path}"
    r = await _http.request(method, url, headers=_h(), **kw)
    if r.status_code == 401:
        await _login()
        r = await _http.request(method, url, headers=_h(), **kw)
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except Exception:
            detail = r.text[:200]
        raise SpotbyeError(f"{r.status_code}: {detail}")
    return r


async def search(q: str, types: str = "track,album", limit: int = 12) -> dict:
    return (await _request("GET", "/api/search", params={"q": q, "type": types, "limit": limit})).json()


async def status() -> dict:
    s = (await _request("GET", "/api/settings")).json()
    return {"spotify_configured": bool((s.get("spotify") or {}).get("configured"))}


async def add_download(url: str) -> dict:
    return (await _request("POST", "/api/downloads", json={"url": url})).json()


async def job(job_id: str) -> dict:
    return (await _request("GET", f"/api/downloads/{job_id}")).json()


async def ensure_session() -> None:
    """Make sure streaming calls (which can't retry mid-stream) are authorised."""
    r = await _http.get(f"{settings.spotbye_url}/api/auth", headers=_h())
    if not r.json().get("authenticated"):
        await _login()


def file_stream(rel: str):
    """Async context manager streaming one finished file (call ensure_session() first)."""
    return _http.stream("GET", f"{settings.spotbye_url}/api/files/{quote(rel, safe='/')}", headers=_h(),
                        timeout=httpx.Timeout(300, connect=8))
