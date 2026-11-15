"""Queue Spotify downloads on SpotBye, pull the finished files home and import them."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import time
from pathlib import Path

import mutagen

from . import db, spotbye
from .config import settings

log = logging.getLogger("musichub.downloader")
_BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_wake = asyncio.Event()


def _safe(name: str, fallback: str) -> str:
    name = _BAD.sub("_", (name or "").strip()).strip(". ")
    return (name or fallback)[:120]


def spotify_url(kind: str, spotify_id: str) -> str:
    return f"https://open.spotify.com/{kind}/{spotify_id}"


def existing(spotify_id: str) -> dict | None:
    r = db.q1("SELECT * FROM downloads WHERE spotify_id=? AND status!='failed' ORDER BY id DESC LIMIT 1",
              (spotify_id,))
    return dict(r) if r else None


def enqueue(user: str, kind: str, spotify_id: str, title: str = "", artist: str = "", image: str = "") -> dict:
    if kind not in ("track", "album"):
        raise ValueError("kind must be track or album")
    hit = existing(spotify_id)
    if hit:
        return hit
    now = time.time()
    row_id = db.ex(
        "INSERT INTO downloads(user,kind,spotify_id,url,title,artist,image,status,created,updated) "
        "VALUES(?,?,?,?,?,?,?,'queued',?,?)",
        (user, kind, spotify_id, spotify_url(kind, spotify_id), title, artist, image, now, now))
    _wake.set()
    return dict(db.q1("SELECT * FROM downloads WHERE id=?", (row_id,)))


def _update(row_id: int, **fields) -> None:
    fields["updated"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    db.ex(f"UPDATE downloads SET {cols} WHERE id=?", (*fields.values(), row_id))


def _tags(path: Path) -> tuple[str, str]:
    try:
        f = mutagen.File(path, easy=True)
        tags = f.tags if f is not None and f.tags is not None else {}
        artist = (tags.get("albumartist") or tags.get("artist") or [""])[0]
        album = (tags.get("album") or [""])[0]
        return artist, album
    except Exception:  # unreadable tags -> fall back to the filename
        return "", ""


async def _import(row: dict, job: dict) -> list[str]:
    incoming = settings.download_dir / ".incoming" / str(row["id"])
    incoming.mkdir(parents=True, exist_ok=True)
    final: list[str] = []
    folders: set[str] = set()
    await spotbye.ensure_session()
    for rel in job.get("files") or []:
        tmp = incoming / Path(rel).name
        async with spotbye.file_stream(rel) as r:
            r.raise_for_status()
            with tmp.open("wb") as fh:
                async for chunk in r.aiter_bytes(1 << 16):
                    fh.write(chunk)
        artist, album = _tags(tmp)
        artist = _safe(artist or row.get("artist") or "", "Unknown Artist")
        album = _safe(album or "Singles", "Singles")
        dest_dir = settings.download_dir / artist / album
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / tmp.name
        await asyncio.to_thread(shutil.move, str(tmp), str(dest))
        dest.chmod(0o644)
        final.append(str(dest.relative_to(settings.download_dir)))
        folders.add(f"{artist}/{album}")
    shutil.rmtree(incoming, ignore_errors=True)
    for folder in sorted(folders):
        queue_scan(f"{settings.nd_download_prefix}/{folder}")
    return final


def queue_scan(rel_folder: str) -> None:
    """Scans need a Navidrome admin, so the Music Hub Sync plugin runs them for us."""
    target = f"{settings.nd_library_id}:{rel_folder.strip('/')}"
    db.ex("INSERT OR IGNORE INTO scan_queue(target, added) VALUES(?, ?)", (target, time.time()))


def pop_scans() -> list[str]:
    with db.tx() as c:
        rows = [r["target"] for r in c.execute("SELECT target FROM scan_queue ORDER BY added").fetchall()]
        c.execute("DELETE FROM scan_queue")
    return rows


def pop_stars() -> dict[str, list[str]]:
    """Songs waiting to be hearted, grouped by Navidrome user (filled by the Plex sync)."""
    with db.tx() as c:
        rows = c.execute("SELECT user, nd_id FROM star_queue ORDER BY added").fetchall()
        c.execute("DELETE FROM star_queue")
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r["user"], []).append(r["nd_id"])
    return out


async def _step() -> bool:
    """Advance every unfinished download once. Returns True while work remains."""
    rows = [dict(r) for r in db.q("SELECT * FROM downloads WHERE status IN ('queued','downloading') ORDER BY id")]
    for row in rows:
        try:
            if row["status"] == "queued":
                j = await spotbye.add_download(row["url"])
                _update(row["id"], status="downloading", job_id=j["id"], message="waiting for SpotBye")
                continue
            j = await spotbye.job(row["job_id"])
            st = j.get("status")
            if st in ("queued", "running"):
                pct = j.get("progress")
                msg = j.get("message") or st
                _update(row["id"], message=f"{msg}{f' ({int(pct * 100)}%)' if pct else ''}")
            elif st == "done":
                if not j.get("files"):
                    _update(row["id"], status="failed", message=j.get("message") or "no files produced")
                    continue
                _update(row["id"], status="importing", message="copying to the NAS")
                files = await _import(row, j)
                _update(row["id"], status="done", message=f"{len(files)} file(s) added", files=json.dumps(files))
            else:
                _update(row["id"], status="failed", message=j.get("message") or st or "failed")
        except Exception as e:
            log.exception("download %s", row["id"])
            if row["status"] == "queued":
                _update(row["id"], status="failed", message=str(e)[:300])
            else:
                _update(row["id"], message=f"retrying: {str(e)[:200]}")
    return bool(rows)


async def run_forever() -> None:
    # anything stuck mid-import after a restart gets another go
    db.ex("UPDATE downloads SET status='downloading' WHERE status='importing'")
    while True:
        busy = await _step()
        _wake.clear()
        try:
            await asyncio.wait_for(_wake.wait(), timeout=3 if busy else 30)
        except asyncio.TimeoutError:
            pass


def local_file(row: dict) -> Path | None:
    files = json.loads(row.get("files") or "[]")
    return settings.download_dir / files[0] if files else None


async def wait_done(row_id: int, timeout: float) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        r = dict(db.q1("SELECT * FROM downloads WHERE id=?", (row_id,)))
        if r["status"] in ("done", "failed"):
            return r
        await asyncio.sleep(1.5)
    return dict(db.q1("SELECT * FROM downloads WHERE id=?", (row_id,)))
