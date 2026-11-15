"""SQLite storage: plays from every source, track enrichment, downloads, caches."""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import unicodedata
from contextlib import contextmanager
from typing import Any, Iterator

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS plays (
    id         INTEGER PRIMARY KEY,
    source     TEXT NOT NULL,              -- navidrome | plex
    user       TEXT NOT NULL,
    ts         INTEGER NOT NULL,           -- unix seconds
    artist     TEXT NOT NULL DEFAULT '',
    album      TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    duration   INTEGER,                    -- seconds, when the source knows it
    ext_id     TEXT NOT NULL DEFAULT '',   -- navidrome media file id / plex ratingKey
    track_key  TEXT NOT NULL,
    UNIQUE (source, user, ts, ext_id)
);
CREATE INDEX IF NOT EXISTS plays_user_ts ON plays (user, ts);
CREATE INDEX IF NOT EXISTS plays_track ON plays (track_key);

-- one row per distinct song (normalised artist|title), matched to Navidrome
CREATE TABLE IF NOT EXISTS tracks (
    track_key  TEXT PRIMARY KEY,
    artist     TEXT, title TEXT, album TEXT,
    nd_id      TEXT, album_id TEXT, artist_id TEXT,
    genre      TEXT, duration INTEGER, year INTEGER,
    resolved   INTEGER NOT NULL DEFAULT 0  -- 0 = todo, 1 = matched, 2 = no match
);

CREATE TABLE IF NOT EXISTS nd_songs (       -- getSong cache for plugin scrobbles
    id TEXT PRIMARY KEY, data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
    id         INTEGER PRIMARY KEY,
    user       TEXT NOT NULL,
    kind       TEXT NOT NULL,              -- track | album
    spotify_id TEXT NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT, artist TEXT, image TEXT,
    job_id     TEXT,
    status     TEXT NOT NULL,              -- queued | downloading | importing | done | failed
    message    TEXT,
    files      TEXT NOT NULL DEFAULT '[]', -- final paths relative to DOWNLOAD_DIR
    created    REAL NOT NULL, updated REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS downloads_spotify ON downloads (spotify_id);

CREATE TABLE IF NOT EXISTS spcache (        -- spotify items handed out by the subsonic proxy
    id TEXT PRIMARY KEY, data TEXT NOT NULL, ts REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);

-- folders waiting for a Navidrome scan; the Navidrome plugin picks them up (scans need admin)
-- public, read-only Rewind snapshots ("share link")
CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY, user TEXT NOT NULL, year INTEGER NOT NULL, data TEXT NOT NULL, created REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_queue (target TEXT PRIMARY KEY, added REAL NOT NULL);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(settings.data_dir / "musichub.db", check_same_thread=False, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.executescript(SCHEMA)
        _conn = c
    return _conn


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    with _lock:
        c = conn()
        c.execute("BEGIN")
        try:
            yield c
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise


def q(sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
    with _lock:
        return conn().execute(sql, args).fetchall()


def q1(sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
    with _lock:
        return conn().execute(sql, args).fetchone()


def ex(sql: str, args: tuple | list = ()) -> int:
    with _lock:
        cur = conn().execute(sql, args)
        return cur.lastrowid or cur.rowcount


def kv_get(k: str, default: str | None = None) -> str | None:
    r = q1("SELECT v FROM kv WHERE k=?", (k,))
    return r["v"] if r else default


def kv_set(k: str, v: Any) -> None:
    ex("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))


def cache_put(id_: str, data: dict) -> None:
    ex("INSERT INTO spcache(id,data,ts) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, ts=excluded.ts",
       (id_, json.dumps(data), time.time()))


def cache_get(id_: str) -> dict | None:
    r = q1("SELECT data FROM spcache WHERE id=?", (id_,))
    return json.loads(r["data"]) if r else None


# ------------------------------------------------------------ normalisation
_PAREN = re.compile(r"\s*[\(\[][^\)\]]*(remaster|version|edit|mix|live|mono|stereo|deluxe|feat|ft\.|with )[^\)\]]*[\)\]]", re.I)
_FEAT = re.compile(r"\s+(feat\.?|ft\.?|featuring|with)\s+.*$", re.I)
_DASH = re.compile(r"\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$", re.I)
_NONWORD = re.compile(r"[^\w]+")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode() or (s or "")
    s = _PAREN.sub("", s)
    s = _DASH.sub("", s)
    s = _FEAT.sub("", s)
    return _NONWORD.sub(" ", s.lower()).strip()


def primary_artist(artist: str) -> str:
    for sep in (";", ",", " & ", " x ", " feat", " ft.", " featuring ", "/"):
        if sep in (artist or ""):
            artist = artist.split(sep, 1)[0]
    return artist.strip()


VARIOUS = ("various artists", "verschiedene interpreten", "various", "va", "diverse", "sampler")


def is_various(artist: str) -> bool:
    return norm(artist) in VARIOUS


def track_key(artist: str, title: str) -> str:
    return f"{norm(primary_artist(artist))}|{norm(title)}"


def add_play(source: str, user: str, ts: int, artist: str, album: str, title: str,
             duration: int | None, ext_id: str) -> bool:
    key = track_key(artist, title)
    with _lock:
        c = conn()
        cur = c.execute(
            "INSERT OR IGNORE INTO plays(source,user,ts,artist,album,title,duration,ext_id,track_key) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (source, user, int(ts), artist or "", album or "", title or "", duration, ext_id or "", key))
        if cur.rowcount:
            c.execute("INSERT OR IGNORE INTO tracks(track_key,artist,title,album,duration) VALUES(?,?,?,?,?)",
                      (key, artist, title, album, duration))
        return bool(cur.rowcount)
