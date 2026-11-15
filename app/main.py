"""Music Hub: Spotify search + downloads, combined Navidrome/Plex stats, Rewind, Subsonic proxy."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, downloader, navidrome, plex, proxy, spotbye, stats
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # request URLs carry tokens/credentials
log = logging.getLogger("musichub")
STATIC = Path(__file__).resolve().parent.parent / "static"
COOKIE = "musichub_session"
SESSION_DAYS = 30


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.conn()
    tasks = [asyncio.create_task(c()) for c in (downloader.run_forever, plex.plex_loop, plex.enrich_loop)]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Music Hub", lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(proxy.router)


# ------------------------------------------------------------------ sessions
def _sign(data: str) -> str:
    return hmac.new(settings.session_secret.encode(), data.encode(), hashlib.sha256).hexdigest()


def make_session(user: str) -> str:
    payload = f"{user}|{int(time.time()) + SESSION_DAYS * 86400}"
    return base64.urlsafe_b64encode(payload.encode()).decode() + "." + _sign(payload)


def read_session(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    b64, sig = token.rsplit(".", 1)
    try:
        payload = base64.urlsafe_b64decode(b64.encode()).decode()
    except Exception:
        return None
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    user, exp = payload.rsplit("|", 1)
    return user if int(exp) > time.time() else None


def current_user(request: Request) -> str:
    user = read_session(request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(401, "sign in first")
    return user


class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(body: LoginBody, response: Response, request: Request):
    if not await navidrome.check_login(body.username, body.password):
        raise HTTPException(401, "Wrong Navidrome username or password")
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(COOKIE, make_session(body.username), max_age=SESSION_DAYS * 86400,
                        httponly=True, samesite="lax", secure=secure)
    return {"user": body.username}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
async def me(user: str = Depends(current_user)):
    spotify = False
    if settings.spotbye_enabled:
        try:
            spotify = (await spotbye.status())["spotify_configured"]
        except Exception:
            pass
    return {"user": user, "name": settings.public_name, "spotify": spotify, "plex": settings.plex_enabled}


# ------------------------------------------------------------------ search + downloads
@app.get("/api/search")
async def search(q: str, user: str = Depends(current_user)):
    q = q.strip()
    if len(q) < 2:
        return {"library": {}, "spotify": {}, "spotify_error": None}

    async def sp():
        if not settings.spotbye_enabled:
            return {}, "SpotBye is not configured"
        try:
            return await spotbye.search(q, "track,album", 12), None
        except Exception as e:
            return {}, str(e)

    lib, (spot, err) = await asyncio.gather(navidrome.search(q, songs=25, albums=10, artists=6), sp())
    have = {db.track_key(s.get("artist", ""), s.get("title", "")) for s in lib.get("song") or []}
    have_albums = {(db.norm(a.get("artist", "")), db.norm(a.get("name", ""))) for a in lib.get("album") or []}
    for t in spot.get("tracks") or []:
        t["in_library"] = db.track_key(t.get("artists", ""), t.get("name", "")) in have
        t["download"] = downloader.existing(t["spotify_id"])
    for a in spot.get("albums") or []:
        a["in_library"] = (db.norm(db.primary_artist(a.get("artists", ""))), db.norm(a.get("name", ""))) in have_albums
        a["download"] = downloader.existing(a["id"])
    return {"library": lib, "spotify": spot, "spotify_error": err}


class DownloadBody(BaseModel):
    kind: str = Field(pattern="^(track|album)$")
    spotify_id: str = Field(pattern=r"^[A-Za-z0-9]{10,40}$")
    title: str = ""
    artist: str = ""
    image: str = ""


@app.post("/api/downloads")
async def add_download(body: DownloadBody, user: str = Depends(current_user)):
    return downloader.enqueue(user, body.kind, body.spotify_id, body.title, body.artist, body.image)


@app.get("/api/downloads")
async def list_downloads(user: str = Depends(current_user)):
    return [dict(r) for r in db.q("SELECT * FROM downloads ORDER BY id DESC LIMIT 60")]


@app.post("/api/downloads/{row_id}/retry")
async def retry_download(row_id: int, user: str = Depends(current_user)):
    db.ex("UPDATE downloads SET status='queued', job_id=NULL, message='retrying' WHERE id=? AND status='failed'", (row_id,))
    downloader._wake.set()
    return {"ok": True}


# ------------------------------------------------------------------ stats
@app.get("/api/stats")
async def get_stats(period: str = "month", source: str = "all", year: int | None = None,
                    user: str = Depends(current_user)):
    start, end = stats.period(period, year)
    return await asyncio.to_thread(stats.summary, user, start, end, None if source == "all" else source)


@app.get("/api/recent")
async def get_recent(user: str = Depends(current_user)):
    return stats.recent(user)


@app.get("/api/years")
async def get_years(user: str = Depends(current_user)):
    return stats.years(user)


@app.get("/api/rewind")
async def get_rewind(year: int, user: str = Depends(current_user)):
    data = await asyncio.to_thread(stats.rewind, user, year)
    for a in data.get("top_artists") or []:
        if not a.get("artist_id"):
            try:
                a["artist_id"] = await navidrome.artist_id(a["name"])
            except Exception:
                pass
    return data


@app.get("/api/sync-status")
async def sync_status(user: str = Depends(current_user)):
    r = db.q1("SELECT SUM(resolved=0) todo, SUM(resolved=1) matched, SUM(resolved=2) unmatched FROM tracks")
    src = {x["source"]: x["n"] for x in db.q("SELECT source, COUNT(*) n FROM plays WHERE user=? GROUP BY source", (user,))}
    return {"tracks": dict(r), "plays": src}


@app.get("/api/cover")
async def cover(id: str, size: int = 300, user: str = Depends(current_user)):
    r = await navidrome.raw("getCoverArt", id=id, size=min(size, 1200))
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        raise HTTPException(404)
    return Response(r.content, media_type=r.headers["content-type"],
                    headers={"Cache-Control": "private, max-age=86400"})


# ------------------------------------------------------------------ plugin ingest
class Scrobble(BaseModel):
    id: str
    ts: int


class IngestBody(BaseModel):
    user: str
    scrobbles: list[Scrobble]


def _plugin_auth(authorization: str) -> None:
    if not settings.ingest_secret or not hmac.compare_digest(authorization, f"Bearer {settings.ingest_secret}"):
        raise HTTPException(401, "bad ingest secret")


@app.post("/api/plugin/scan-queue")
async def scan_queue(authorization: str = Header("")):
    """The Navidrome plugin collects folders to scan (it holds the admin rights)."""
    _plugin_auth(authorization)
    return {"targets": downloader.pop_scans()}


@app.post("/api/ingest/navidrome")
async def ingest(body: IngestBody, authorization: str = Header("")):
    _plugin_auth(authorization)
    added = 0
    for s in body.scrobbles:
        song = await navidrome.get_song(s.id)
        if not song:
            continue
        ts = s.ts // 1000 if s.ts > 10**11 else s.ts  # accept ms or s
        artist = song.get("artist") or ""
        if db.add_play("navidrome", body.user, ts, artist, song.get("album") or "", song.get("title") or "",
                       song.get("duration"), s.id):
            added += 1
        db.ex("UPDATE tracks SET nd_id=?, album_id=?, artist_id=?, genre=?, duration=?, year=?, resolved=1 "
              "WHERE track_key=? AND resolved != 1",
              (song.get("id"), song.get("albumId"), song.get("artistId"), song.get("genre"), song.get("duration"),
               song.get("year"), db.track_key(artist, song.get("title") or "")))
    return {"added": added, "received": len(body.scrobbles)}


@app.get("/api/health")
async def health():
    return {"ok": True}


# ------------------------------------------------------------------ web app
@app.middleware("http")
async def revalidate_assets(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/assets/"):
        resp.headers["Cache-Control"] = "no-cache"  # always revalidate (ETag), so updates show up at once
    return resp


app.mount("/assets", StaticFiles(directory=STATIC), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
