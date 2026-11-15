"""Subsonic proxy in front of Navidrome.

Every /rest/* call is passed through untouched, except:
  * search2/search3 get Spotify tracks appended (ids "spot-<spotify id>"),
  * calls that carry a "spot-" id are answered here: playing one downloads it
    first, then streams it (from Navidrome once the scan has picked it up).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import parse_qsl, urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from . import db, downloader, navidrome, spotbye
from .config import settings

log = logging.getLogger("musichub.proxy")
router = APIRouter()
NS = "http://subsonic.org/restapi"
ET.register_namespace("", NS)
_http = httpx.AsyncClient(timeout=httpx.Timeout(None, connect=10), follow_redirects=False)
_HOP = {"host", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
        "proxy-authorization", "proxy-authenticate", "content-length"}
_AUTH_KEYS = ("u", "p", "t", "s", "apiKey", "v", "c")
_auth_ok: dict[str, float] = {}
SPOT = "spot-"
SPOT_AL = "spot-al-"


# --------------------------------------------------------------- helpers
def _fmt(params: dict) -> str:
    return "json" if params.get("f") in ("json", "jsonp") else "xml"


def _envelope(payload: dict, status: str = "ok") -> dict:
    return {"status": status, "version": "1.16.1", "type": "navidrome", "serverVersion": "musichub",
            "openSubsonic": True, **payload}


def _to_xml(parent: ET.Element, key: str, value) -> None:
    if isinstance(value, list):
        for v in value:
            _to_xml(parent, key, v)
        return
    el = ET.SubElement(parent, f"{{{NS}}}{key}")
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                _to_xml(el, k, v)
            elif v is not None:
                el.set(k, str(v).lower() if isinstance(v, bool) else str(v))
    elif value is not None:
        el.text = str(value)


def reply(params: dict, payload: dict | None = None, error: tuple[int, str] | None = None) -> Response:
    body = _envelope({"error": {"code": error[0], "message": error[1]}} if error else (payload or {}),
                     "failed" if error else "ok")
    if _fmt(params) == "json":
        return JSONResponse({"subsonic-response": body})
    root = ET.Element(f"{{{NS}}}subsonic-response")
    for k, v in body.items():
        if isinstance(v, (dict, list)):
            _to_xml(root, k, v)
        else:
            root.set(k, str(v).lower() if isinstance(v, bool) else str(v))
    return Response(ET.tostring(root, xml_declaration=True, encoding="UTF-8"), media_type="application/xml")


def _headers_out(request: Request, keep_encoding: bool = True) -> dict:
    h = {k: v for k, v in request.headers.items() if k.lower() not in _HOP}
    if keep_encoding:
        # raw passthrough: only ask Navidrome for an encoding the client itself accepts
        h.setdefault("accept-encoding", "identity")
    else:
        h.pop("accept-encoding", None)
    return h


async def _forward(request: Request, query: str, body: bytes, stream: bool) -> Response:
    url = httpx.URL(f"{settings.nd_url}{request.url.path}" + (f"?{query}" if query else ""))
    req = _http.build_request(request.method, url, content=body or None, headers=_headers_out(request, stream))
    r = await _http.send(req, stream=stream)
    if not stream:
        hdrs = {k: v for k, v in r.headers.items() if k.lower() not in _HOP | {"content-encoding"}}
        return Response(r.content, status_code=r.status_code, headers=hdrs)
    hdrs = {k: v for k, v in r.headers.items() if k.lower() not in _HOP - {"content-length"}}

    async def body_iter():
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()
    return StreamingResponse(body_iter(), status_code=r.status_code, headers=hdrs)


async def _authorized(params: dict) -> str | None:
    """Check the caller's Subsonic credentials against Navidrome. Returns the username."""
    creds = {k: params[k] for k in _AUTH_KEYS if k in params}
    key = hashlib.sha256(urlencode(sorted(creds.items())).encode()).hexdigest()
    user = params.get("u") or "apikey"
    if _auth_ok.get(key, 0) > time.time():
        return user
    try:
        r = await _http.get(f"{settings.nd_url}/rest/ping", params={**creds, "f": "json"}, timeout=10)
        ok = r.json()["subsonic-response"]["status"] == "ok"
    except Exception:
        ok = False
    if ok:
        _auth_ok[key] = time.time() + 600
        return user
    return None


# --------------------------------------------------------------- spotify -> subsonic
def _song_from_spotify(t: dict) -> dict:
    sid = SPOT + t["spotify_id"]
    m = re.search(r"album/([A-Za-z0-9]+)", t.get("album_url") or "")
    al = SPOT_AL + m.group(1) if m else ""
    year = (t.get("release_date") or "")[:4]
    song = {
        "id": sid, "parent": al, "isDir": False, "title": t.get("name") or "",
        "album": f"{t.get('album_name') or ''} · Spotify", "artist": t.get("artists") or "",
        "coverArt": sid, "duration": int((t.get("duration_ms") or 0) / 1000),
        "suffix": "flac", "contentType": "audio/flac", "type": "music", "isVideo": False,
        "path": f"Spotify/{t.get('artists')}/{t.get('name')}.flac",
    }
    if year.isdigit():
        song["year"] = int(year)
    if al:
        song["albumId"] = al
    old = db.cache_get(sid) or {}
    db.cache_put(sid, {**old, "song": song, "image": t.get("images"), "title": t.get("name"),
                       "artist": t.get("artists"), "album_id": al})
    if al:
        alb = db.cache_get(al) or {"songs": []}
        if sid not in alb["songs"]:
            alb["songs"].append(sid)
        alb.update({"name": t.get("album_name"), "artist": t.get("artists"), "image": t.get("images"),
                    "year": song.get("year")})
        db.cache_put(al, alb)
    return song


async def _spotify_songs(query: str, have: set[str]) -> list[dict]:
    try:
        res = await asyncio.wait_for(spotbye.search(query, "track", 10), timeout=6)
    except Exception as e:
        log.info("spotify search skipped: %s", e)
        return []
    out = []
    for t in res.get("tracks") or []:
        if db.track_key(t.get("artists", ""), t.get("name", "")) in have:
            continue  # already in the library
        out.append(_song_from_spotify(t))
    return out


async def _search(request: Request, name: str, params: dict, query: str, body: bytes) -> Response:
    resp = await _forward(request, query, body, stream=False)
    q = (params.get("query") or "").strip().strip('"').strip()
    offset = int(params.get("songOffset") or 0)
    if resp.status_code != 200 or len(q) < 2 or offset > 0 or not settings.spotbye_enabled:
        return resp
    key = "searchResult3" if name == "search3" else "searchResult2"
    ctype = resp.headers.get("content-type", "")
    try:
        if "json" in ctype:
            import json
            doc = json.loads(resp.body)
            sr = doc.get("subsonic-response", {})
            if sr.get("status") != "ok":
                return resp
            res = sr.setdefault(key, {})
            have = {db.track_key(s.get("artist", ""), s.get("title", "")) for s in res.get("song") or []}
            extra = await _spotify_songs(q, have)
            if extra:
                res.setdefault("song", []).extend(extra)
            return JSONResponse(doc)
        root = ET.fromstring(resp.body)
        if root.get("status") != "ok":
            return resp
        res = root.find(f"{{{NS}}}{key}")
        if res is None:
            res = ET.SubElement(root, f"{{{NS}}}{key}")
        have = {db.track_key(s.get("artist", ""), s.get("title", "")) for s in res.findall(f"{{{NS}}}song")}
        for s in await _spotify_songs(q, have):
            _to_xml(res, "song", s)
        return Response(ET.tostring(root, xml_declaration=True, encoding="UTF-8"), media_type=ctype or "application/xml")
    except Exception:
        log.exception("search injection failed")
        return resp


async def _find_in_library(item: dict, wait: float = 6) -> str | None:
    key = db.track_key(item.get("artist", ""), item.get("title", ""))
    end = time.time() + wait
    while True:
        try:
            res = await navidrome.search(f"{db.primary_artist(item.get('artist', ''))} {item.get('title', '')}",
                                         songs=15, albums=0, artists=0)
            for s in res.get("song") or []:
                if db.track_key(s.get("artist", ""), s.get("title", "")) == key:
                    return s["id"]
        except Exception:
            pass
        if time.time() > end:
            return None
        await asyncio.sleep(2)


async def _ensure_local(sid: str, item: dict, user: str) -> tuple[str | None, dict | None]:
    """Download the track if needed. Returns (navidrome id, download row)."""
    if item.get("nd_id"):
        return item["nd_id"], None
    row = downloader.enqueue(user, "track", sid[len(SPOT):], item.get("title") or "", item.get("artist") or "",
                             item.get("image") or "")
    row = await downloader.wait_done(row["id"], timeout=180)
    if row["status"] != "done":
        return None, row
    nd_id = await _find_in_library(item)
    if nd_id:
        item["nd_id"] = nd_id
        db.cache_put(sid, item)
    return nd_id, row


def _swap_id(query: str, old: str, new: str) -> str:
    return urlencode([(k, new if (k == "id" and v == old) else v) for k, v in parse_qsl(query, keep_blank_values=True)])


async def _spot_call(request: Request, name: str, params: dict, query: str, body: bytes) -> Response:
    user = await _authorized(params)
    if not user:
        return reply(params, error=(40, "Wrong username or password"))
    sid = params["id"]
    item = db.cache_get(sid)
    if not item:
        return reply(params, error=(70, "Unknown Spotify item, search for it again"))

    if name == "getCoverArt":
        if not item.get("image"):
            return Response(status_code=404)
        r = await _http.get(item["image"], timeout=15)
        return Response(r.content, media_type=r.headers.get("content-type", "image/jpeg"),
                        headers={"Cache-Control": "public, max-age=604800"})
    if name == "getSong":
        return reply(params, {"song": item["song"]})
    if name == "getAlbum" and sid.startswith(SPOT_AL):
        songs = [s["song"] for s in (db.cache_get(i) for i in item.get("songs", [])) if s]
        album = {"id": sid, "name": f"{item.get('name')} · Spotify", "artist": item.get("artist"), "coverArt": sid,
                 "songCount": len(songs), "duration": sum(s.get("duration", 0) for s in songs),
                 "year": item.get("year"), "song": songs}
        return reply(params, {"album": album})

    if name in ("stream", "download"):
        nd_id, row = await _ensure_local(sid, item, user)
        if nd_id:
            return await _forward(request, _swap_id(query, sid, nd_id), body, stream=True)
        path = downloader.local_file(row) if row and row["status"] == "done" else None
        if path and path.exists():
            return FileResponse(path)
        msg = (row or {}).get("message") or "download not finished"
        return reply(params, error=(70, f"Not available yet: {msg}"))

    # scrobble/star/rating etc.: forward with the real id once we have one, otherwise accept quietly
    if item.get("nd_id") and not sid.startswith(SPOT_AL):
        return await _forward(request, _swap_id(query, sid, item["nd_id"]), body, stream=False)
    return reply(params, {})


@router.api_route("/rest/{endpoint:path}", methods=["GET", "POST"])
async def rest(endpoint: str, request: Request):
    name = endpoint.rsplit("/", 1)[-1].removesuffix(".view")
    query = request.url.query
    body = await request.body()
    params = dict(parse_qsl(query, keep_blank_values=True))
    if request.method == "POST" and "application/x-www-form-urlencoded" in request.headers.get("content-type", ""):
        params.update(parse_qsl(body.decode(errors="ignore"), keep_blank_values=True))
        # fold the form into the query so id rewriting and forwarding see one parameter set
        query = urlencode(list(parse_qsl(query, keep_blank_values=True)) +
                          list(parse_qsl(body.decode(errors="ignore"), keep_blank_values=True)))
        body = b""
    if name in ("search2", "search3"):
        return await _search(request, name, params, query, body)
    if params.get("id", "").startswith(SPOT):
        return await _spot_call(request, name, params, query, body)
    return await _forward(request, query, body, stream=True)
