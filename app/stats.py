"""Listening statistics and the yearly Rewind, computed from the plays table."""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from . import db

TZ = ZoneInfo("Europe/Berlin")
DEFAULT_LEN = 210  # seconds, when nobody knows a track's length

# a play's length: the source's own value, else the matched Navidrome track, else a typical song
DUR = f"COALESCE(p.duration, t.duration, {DEFAULT_LEN})"
BASE = "FROM plays p LEFT JOIN tracks t ON t.track_key = p.track_key"
# compilations: Plex only knows "Various Artists", the matched Navidrome track knows the real one
VA_SQL = "('various artists','verschiedene interpreten','various','va','diverse','sampler')"
ART = f"(CASE WHEN lower(p.artist) IN {VA_SQL} THEN COALESCE(NULLIF(t.artist,''), p.artist) ELSE p.artist END)"
NOT_VA = f" AND lower({ART}) NOT IN {VA_SQL}"


def _where(user: str, start: int, end: int, source: str | None) -> tuple[str, list]:
    sql = " WHERE p.user = ? AND p.ts >= ? AND p.ts < ?"
    args: list = [user, start, end]
    if source in ("navidrome", "plex"):
        sql += " AND p.source = ?"
        args.append(source)
    return sql, args


def period(name: str, year: int | None = None) -> tuple[int, int]:
    now = dt.datetime.now(TZ)
    if name == "year":
        y = year or now.year
        return (int(dt.datetime(y, 1, 1, tzinfo=TZ).timestamp()), int(dt.datetime(y + 1, 1, 1, tzinfo=TZ).timestamp()))
    days = {"week": 7, "month": 30, "quarter": 90}.get(name)
    end = int(now.timestamp()) + 1
    return (end - days * 86400, end) if days else (0, end)


def _top(user, start, end, source, group, label_cols, limit=10, extra=""):
    w, a = _where(user, start, end, source)
    return [dict(r) for r in db.q(
        f"SELECT {label_cols}, COUNT(*) plays, SUM({DUR}) secs {BASE}{w} AND {group} != ''{extra} "
        f"GROUP BY {group} ORDER BY plays DESC, secs DESC LIMIT ?", (*a, limit))]


def summary(user: str, start: int, end: int, source: str | None = None) -> dict:
    w, a = _where(user, start, end, source)
    tot = db.q1(f"SELECT COUNT(*) plays, COALESCE(SUM({DUR}),0) secs, COUNT(DISTINCT p.track_key) songs {BASE}{w}", a)
    n_artists = db.q1(f"SELECT COUNT(DISTINCT lower({ART})) n {BASE}{w}{NOT_VA}", a)["n"]
    by_source = {r["source"]: {"plays": r["plays"], "secs": r["secs"]} for r in db.q(
        f"SELECT p.source, COUNT(*) plays, SUM({DUR}) secs {BASE}{w} GROUP BY p.source", a)}
    hours = [0] * 24
    weekdays = [0] * 7
    daily: dict[str, int] = {}
    for r in db.q(f"SELECT p.ts, {DUR} d {BASE}{w}", a):
        t = dt.datetime.fromtimestamp(r["ts"], TZ)
        hours[t.hour] += r["d"]
        weekdays[t.weekday()] += r["d"]
        k = t.strftime("%Y-%m-%d")
        daily[k] = daily.get(k, 0) + r["d"]
    return {
        "plays": tot["plays"], "minutes": round(tot["secs"] / 60), "songs": tot["songs"], "artists": n_artists,
        "by_source": by_source,
        "top_artists": _top(user, start, end, source, f"lower({ART})", f"{ART} name, MAX(t.artist_id) artist_id",
                            extra=NOT_VA),
        "top_tracks": _top(user, start, end, source, "p.track_key",
                           f"p.title name, {ART} artist, MAX(t.album_id) album_id, MAX(t.nd_id) nd_id, "
                           "p.track_key track_key, MAX(t.duration) duration"),
        "top_albums": _top(user, start, end, source, "lower(p.album)",
                           "p.album name, p.artist artist, MAX(t.album_id) album_id"),
        "top_genres": _top(user, start, end, source, "COALESCE(t.genre,'')", "t.genre name", 8),
        "hours": [round(h / 60) for h in hours],
        "weekdays": [round(d / 60) for d in weekdays],
        "daily": [{"day": k, "minutes": round(v / 60)} for k, v in sorted(daily.items())],
    }


def recent(user: str, limit: int = 30) -> list[dict]:
    return [dict(r) for r in db.q(
        f"SELECT p.source, p.ts, {ART} artist, p.title, p.album, t.album_id {BASE} WHERE p.user=? ORDER BY p.ts DESC LIMIT ?",
        (user, limit))]


def years(user: str) -> list[int]:
    rows = db.q("SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch') AS INTEGER) y FROM plays WHERE user=? ORDER BY y DESC",
                (user,))
    return [r["y"] for r in rows]


def _persona(hours: list[int]) -> dict:
    buckets = {"Frühaufsteher": range(5, 10), "Tagträumer": range(10, 17),
               "Abendrot-Hörer": range(17, 21), "Nachteule": list(range(21, 24)) + list(range(0, 5))}
    totals = {k: sum(hours[h] for h in v) for k, v in buckets.items()}
    name = max(totals, key=totals.get)
    blurbs = {
        "Frühaufsteher": "Deine Musik ist wach, bevor es alle anderen sind.",
        "Tagträumer": "Der Soundtrack zu deinem Tag, jeden Tag.",
        "Abendrot-Hörer": "Das Beste hebst du dir für den Sonnenuntergang auf.",
        "Nachteule": "Wenn die Stadt schläft, sind deine Kopfhörer auf.",
    }
    peak = max(range(24), key=lambda h: hours[h])
    return {"name": name, "blurb": blurbs[name], "peak_hour": peak}


def rewind(user: str, year: int) -> dict:
    start, end = period("year", year)
    s = summary(user, start, end)
    if not s["plays"]:
        return {"year": year, "empty": True}
    w, a = _where(user, start, end, None)
    # artists heard for the very first time this year
    new_artists = db.q(
        f"SELECT {ART} name, COUNT(*) plays {BASE}{w}{NOT_VA} AND lower({ART}) NOT IN "
        f"(SELECT DISTINCT lower({ART}) {BASE} WHERE p.user=? AND p.ts < ?) "
        f"GROUP BY lower({ART}) ORDER BY plays DESC LIMIT 5", (*a, user, start))
    first = db.q1(f"SELECT p.title, p.artist, p.ts, t.album_id {BASE}{w} ORDER BY p.ts ASC LIMIT 1", a)
    busiest = max(s["daily"], key=lambda d: d["minutes"]) if s["daily"] else None
    # longest run of consecutive listening days
    days = sorted(dt.date.fromisoformat(d["day"]) for d in s["daily"])
    streak = best = 1 if days else 0
    for prev, cur in zip(days, days[1:]):
        streak = streak + 1 if (cur - prev).days == 1 else 1
        best = max(best, streak)
    months = [0] * 12
    for d in s["daily"]:
        months[int(d["day"][5:7]) - 1] += d["minutes"]
    top_track = s["top_tracks"][0] if s["top_tracks"] else None
    top_track_first = None
    if top_track:
        r = db.q1(f"SELECT MIN(p.ts) ts {BASE}{w} AND p.track_key = ?", (*a, top_track["track_key"]))
        top_track_first = r["ts"] if r else None
    persona = _persona(s["hours"])
    best_month = max(range(12), key=lambda m: months[m])
    age = _musical_age(user, start, end, year)
    top_genres = [g for g in s["top_genres"] if g["name"]][:5]
    new_artists = [dict(r) for r in new_artists]

    # one song from the library behind each slide; no song is used twice
    def picks(extra: str = "", args: tuple = (), n: int = 8) -> list[dict]:
        return [dict(r) for r in db.q(
            f"SELECT p.title, {ART} artist, t.nd_id, t.duration, t.album_id, COUNT(*) plays {BASE}{w} "
            f"AND t.nd_id IS NOT NULL {extra} GROUP BY p.track_key ORDER BY plays DESC LIMIT ?", (*a, *args, n))]

    tops = picks(n=40)
    artists = s["top_artists"]
    wants: list[tuple[str, list[dict]]] = [  # most telling slides choose first
        ("top-song", tops[:1]),
        ("top-artist", picks(f" AND lower({ART}) = lower(?)", (artists[0]["name"],)) if artists else []),
        ("genre", picks(" AND t.genre = ?", (top_genres[0]["name"],)) if top_genres else []),
        ("musical-age", picks(" AND t.year >= ? AND t.year < ?", (age["era"], age["era"] + 10)) if age.get("era") else []),
        ("discoveries", picks(f" AND lower({ART}) = lower(?)", (new_artists[0]["name"],)) if new_artists else []),
        ("persona", picks(" AND CAST(strftime('%H', p.ts, 'unixepoch', 'localtime') AS INTEGER) = ?", (persona["peak_hour"],))),
        ("months", picks(" AND CAST(strftime('%m', p.ts, 'unixepoch', 'localtime') AS INTEGER) = ?", (best_month + 1,))),
        ("top-songs", tops[1:5]),
        ("top-artists", picks(f" AND lower({ART}) = lower(?)", (artists[1]["name"],)) if len(artists) > 1 else []),
        ("intro", []), ("minutes", []), ("sources", []), ("summary", []),
    ]
    used: set[str] = set()
    soundtrack: dict[str, dict] = {}
    for slide, cands in wants:
        for t in [*cands, *tops]:  # fall back to any other top song not heard yet
            if t["nd_id"] not in used:
                used.add(t["nd_id"])
                soundtrack[slide] = {k: t[k] for k in ("title", "artist", "nd_id", "duration", "album_id")}
                break

    return {
        "year": year, "empty": False,
        "minutes": s["minutes"], "plays": s["plays"], "songs": s["songs"], "artists": s["artists"],
        "days_listened": len(days), "streak": best,
        "top_artists": s["top_artists"][:5], "top_tracks": s["top_tracks"][:5], "top_albums": s["top_albums"][:5],
        "top_genres": top_genres, "persona": persona, "hours": s["hours"], "months": months, "best_month": best_month,
        "busiest_day": busiest, "first_play": dict(first) if first else None,
        "new_artists": new_artists, "by_source": s["by_source"],
        "top_track_first_ts": top_track_first, "musical_age": age,
        "soundtrack": soundtrack,
    }


# Listening age: people tend to love the music of their late teens most ("reminiscence bump"),
# so the median release year of what you play, seen from age ~17, says how "old" your taste is.
BUMP_AGE = 17


def _musical_age(user: str, start: int, end: int, year: int) -> dict:
    w, a = _where(user, start, end, None)
    rows = db.q(f"SELECT t.year y, COUNT(*) n {BASE}{w} AND t.year > 1900 AND t.year <= ? GROUP BY t.year ORDER BY t.year",
                (*a, year))
    total = sum(r["n"] for r in rows)
    if total < 20:
        return {}
    acc, median = 0, rows[-1]["y"]
    for r in rows:
        acc += r["n"]
        if acc >= total / 2:
            median = r["y"]
            break
    decades: dict[int, int] = {}
    for r in rows:
        d = r["y"] // 10 * 10
        decades[d] = decades.get(d, 0) + r["n"]
    era = max(decades, key=decades.get)
    oldest = db.q1(f"SELECT p.title, {ART} artist, t.year, t.album_id {BASE}{w} AND t.year > 1900 "
                   "ORDER BY t.year ASC, p.ts ASC LIMIT 1", a)
    age = max(10, min(99, year - median + BUMP_AGE))
    return {
        "age": age, "median_year": median, "era": era, "coverage": round(total / max(1, _count(w, a)) * 100),
        "decades": [{"decade": d, "plays": n} for d, n in sorted(decades.items())],
        "oldest": dict(oldest) if oldest else None,
    }


def _count(w: str, a: list) -> int:
    return db.q1(f"SELECT COUNT(*) n {BASE}{w}", a)["n"]
