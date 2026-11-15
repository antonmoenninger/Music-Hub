"""Music Hub: Spotify search + downloads, combined Navidrome/Plex stats, Rewind, Subsonic proxy."""
from __future__ import annotations

import asyncio
import base64
import json
import secrets
import hashlib
import hmac
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import clips, db, downloader, navidrome, plex, proxy, spotbye, stats
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


def make_session(user: str, admin: bool = False) -> str:
    payload = f"{user}|{int(admin)}|{int(time.time()) + SESSION_DAYS * 86400}"
    return base64.urlsafe_b64encode(payload.encode()).decode() + "." + _sign(payload)


def read_session_full(token: str | None) -> tuple[str, bool] | None:
    if not token or "." not in token:
        return None
    b64, sig = token.rsplit(".", 1)
    try:
        payload = base64.urlsafe_b64decode(b64.encode()).decode()
    except Exception:
        return None
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    parts = payload.split("|")
    user, exp = "|".join(parts[:-2] if len(parts) > 2 else parts[:-1]), parts[-1]
    admin = len(parts) > 2 and parts[-2] == "1"
    return (user, admin) if int(exp) > time.time() else None


def read_session(token: str | None) -> str | None:
    s = read_session_full(token)
    return s[0] if s else None


def current_user(request: Request) -> str:
    user = read_session(request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(401, "sign in first")
    return user


def admin_user(request: Request) -> str:
    s = read_session_full(request.cookies.get(COOKIE))
    if not s:
        raise HTTPException(401, "sign in first")
    if not s[1]:
        raise HTTPException(403, "Nur für Navidrome-Admins")
    return s[0]


class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(body: LoginBody, response: Response, request: Request):
    info = await navidrome.native_login(body.username, body.password)
    if not info:
        raise HTTPException(401, "Falscher Navidrome-Benutzername oder falsches Passwort")
    user = info.get("username") or body.username  # Navidrome's own spelling of the name
    admin = bool(info.get("isAdmin"))
    if admin:
        try:
            await navidrome.list_users(info["token"])  # remember the user list for the accounts page
        except Exception as e:
            log.warning("could not list Navidrome users: %s", e)
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(COOKIE, make_session(user, admin), max_age=SESSION_DAYS * 86400,
                        httponly=True, samesite="lax", secure=secure)
    return {"user": user, "admin": admin}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
async def me(request: Request, user: str = Depends(current_user)):
    spotify = False
    if settings.spotbye_enabled:
        try:
            spotify = (await spotbye.status())["spotify_configured"]
        except Exception:
            pass
    admin = (read_session_full(request.cookies.get(COOKIE)) or ("", False))[1]
    return {"user": user, "name": settings.public_name, "spotify": spotify, "plex": settings.plex_enabled, "admin": admin}


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


_prewarm_tasks: set[asyncio.Task] = set()


@app.get("/api/rewind")
async def get_rewind(year: int, user: str = Depends(current_user)):
    data = await asyncio.to_thread(stats.rewind, user, year)
    if data.get("soundtrack"):
        t = asyncio.create_task(clips.prewarm(list(data["soundtrack"].values())))  # clips ready before their slide
        _prewarm_tasks.add(t)
        t.add_done_callback(_prewarm_tasks.discard)
    for a in data.get("top_artists") or []:
        if not a.get("artist_id"):
            try:
                a["artist_id"] = await navidrome.artist_id(a["name"])
            except Exception:
                pass
    return data


def _cover_ids(data: dict) -> set[str]:
    ids: set[str] = set()
    for key in ("top_tracks", "top_albums"):
        ids |= {x["album_id"] for x in data.get(key) or [] if x.get("album_id")}
    ids |= {"ar-" + x["artist_id"] for x in data.get("top_artists") or [] if x.get("artist_id")}
    ids |= {x["album_id"] for x in (data.get("soundtrack") or {}).values() if x.get("album_id")}
    oldest = (data.get("musical_age") or {}).get("oldest") or {}
    if oldest.get("album_id"):
        ids.add(oldest["album_id"])
    return ids


class ShareBody(BaseModel):
    year: int


@app.post("/api/rewind/share")
async def share_rewind(body: ShareBody, user: str = Depends(current_user)):
    """Freeze this Rewind into a public, read-only snapshot (no music, no login needed)."""
    data = await get_rewind(body.year, user)
    if data.get("empty"):
        raise HTTPException(404, "no plays that year")
    data.pop("soundtrack", None)  # the library is not streamed to the public
    old = db.q1("SELECT token FROM shares WHERE user=? AND year=?", (user, body.year))
    token = old["token"] if old else secrets.token_urlsafe(9)
    db.ex("INSERT OR REPLACE INTO shares(token,user,year,data,created) VALUES(?,?,?,?,?)",
          (token, user, body.year, json.dumps({**data, "user": user}), time.time()))
    return {"token": token, "path": f"/r/{token}"}


@app.delete("/api/rewind/share/{token}")
async def unshare_rewind(token: str, user: str = Depends(current_user)):
    db.ex("DELETE FROM shares WHERE token=? AND user=?", (token, user))
    return {"ok": True}


def _share(token: str) -> dict:
    r = db.q1("SELECT data FROM shares WHERE token=?", (token,))
    if not r:
        raise HTTPException(404, "This Rewind is no longer shared")
    return json.loads(r["data"])


@app.get("/api/public/rewind/{token}")
async def public_rewind(token: str):
    return _share(token)


@app.get("/api/public/cover/{token}")
async def public_cover(token: str, id: str, size: int = 300):
    if id not in _cover_ids(_share(token)):
        raise HTTPException(404)
    return await _cover(id, size)


@app.get("/api/clip/{song_id}")
async def clip(song_id: str, user: str = Depends(current_user)):
    """~40 s MP3 of a library song from near its chorus, for the Rewind soundtrack."""
    p = await clips.ensure(song_id)
    if not p:
        raise HTTPException(404, "song not playable")
    return FileResponse(p, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=604800"})


@app.get("/api/stream/{song_id}")
async def stream_song(song_id: str, request: Request, user: str = Depends(current_user)):
    """Raw stream of a library song for the Rewind soundtrack (Range requests pass through)."""
    params = navidrome._auth(settings.nd_user, settings.nd_pass)
    params.pop("f")
    params.update({"id": song_id, "format": "raw"})
    headers = {"Range": request.headers["range"]} if "range" in request.headers else {}
    req = proxy._http.build_request("GET", f"{settings.nd_url}/rest/stream", params=params, headers=headers)
    r = await proxy._http.send(req, stream=True)
    if r.status_code not in (200, 206) or not r.headers.get("content-type", "").startswith("audio"):
        await r.aclose()
        raise HTTPException(404, "song not playable")
    keep = {k: v for k, v in r.headers.items()
            if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag")}

    async def body():
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()
    return StreamingResponse(body(), status_code=r.status_code, headers={**keep, "Cache-Control": "private, max-age=3600"})


# ------------------------------------------------------------------ accounts (admins)
@app.get("/api/admin/accounts")
async def admin_accounts(user: str = Depends(admin_user)):
    if settings.plex_enabled:
        try:
            await plex.accounts()
        except Exception as e:
            log.warning("plex accounts: %s", e)
    stats_by = {r["account"]: dict(r) for r in db.q(
        "SELECT account, COUNT(*) plays, MAX(ts) last_ts FROM plays WHERE source='plex' GROUP BY account")}
    plex_rows = []
    for r in db.q("SELECT account, plex_name, nd_user FROM plex_links ORDER BY account"):
        st = stats_by.get(r["account"], {})
        if not r["plex_name"] and not st:
            continue  # Plex's nameless system account
        plex_rows.append({"account": r["account"], "name": r["plex_name"] or f"Konto {r['account']}",
                          "nd_user": r["nd_user"], "plays": st.get("plays", 0), "last_ts": st.get("last_ts")})
    plex_rows.sort(key=lambda x: -x["plays"])
    nd_plays = {r["user"]: r["n"] for r in db.q("SELECT user, COUNT(*) n FROM plays WHERE source='navidrome' GROUP BY user")}
    users = [{"userName": r["user_name"], "name": r["name"], "isAdmin": bool(r["is_admin"]), "lastLogin": r["last_login"],
              "plays": nd_plays.get(r["user_name"], 0)}
             for r in db.q("SELECT * FROM nd_users ORDER BY lower(user_name)") if r["user_name"] != settings.nd_user]
    return {"plex": plex_rows, "nd_users": users}


class LinkBody(BaseModel):
    nd_user: str | None = None


@app.put("/api/admin/accounts/{account}")
async def admin_link(account: str, body: LinkBody, user: str = Depends(admin_user)):
    if body.nd_user and not db.q1("SELECT 1 FROM nd_users WHERE user_name=?", (body.nd_user,)):
        raise HTTPException(404, "Unbekannter Navidrome-Benutzer")
    moved = db.link_plex(account, body.nd_user)
    return {"ok": True, "moved_plays": moved}


class NewUserBody(BaseModel):
    username: str = Field(min_length=2, max_length=40, pattern=r"^[\w.\-äöüÄÖÜß ]+$")
    name: str = ""
    password: str = Field(min_length=6)
    admin_password: str
    link_account: str | None = None


@app.post("/api/admin/nd-users")
async def admin_create_user(body: NewUserBody, user: str = Depends(admin_user)):
    """Create a Navidrome account (needs the admin's password, used for this request only)."""
    info = await navidrome.native_login(user, body.admin_password)
    if not info or not info.get("isAdmin"):
        raise HTTPException(403, "Admin-Passwort ist falsch")
    username, name = body.username.strip(), body.name.strip() or body.username.strip()
    try:
        await navidrome.create_user(info["token"], username, name, body.password)  # answers with just {"id"}
    except navidrome.NavidromeError as e:
        raise HTTPException(400, f"Navidrome: {e}")
    await navidrome.list_users(info["token"])
    if body.link_account:
        db.link_plex(body.link_account, username)
    return {"userName": username, "name": name, "linked": body.link_account}


@app.get("/api/sync-status")
async def sync_status(user: str = Depends(current_user)):
    r = db.q1("SELECT SUM(resolved=0) todo, SUM(resolved=1) matched, SUM(resolved=2) unmatched FROM tracks")
    src = {x["source"]: x["n"] for x in db.q("SELECT source, COUNT(*) n FROM plays WHERE user=? GROUP BY source", (user,))}
    return {"tracks": dict(r), "plays": src}


@app.get("/api/cover")
async def cover(id: str, size: int = 300, user: str = Depends(current_user)):
    return await _cover(id, size)


async def _cover(id: str, size: int) -> Response:
    r = await navidrome.raw("getCoverArt", id=id, size=min(size, 1200))
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        raise HTTPException(404)
    return Response(r.content, media_type=r.headers["content-type"],
                    headers={"Cache-Control": "public, max-age=86400"})


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


@app.post("/api/plugin/star-queue")
async def star_queue(authorization: str = Header("")):
    """Songs the plugin should heart, per user (stars must be set as that user)."""
    _plugin_auth(authorization)
    return {"stars": downloader.pop_stars()}


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
async def asset_caching(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/assets/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"  # Vite file names carry a hash
    return resp


(STATIC / "assets").mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    f = (STATIC / path).resolve()
    if path and f.is_file() and STATIC.resolve() in f.parents:  # favicon etc. from Vite's public/
        return FileResponse(f)
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
