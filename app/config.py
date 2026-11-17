"""Runtime configuration, read once from environment variables."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _user_map(raw: str) -> dict[str, str]:
    """"1=Anton,334225043=Papa" -> {"1": "Anton", ...} (Plex account id -> hub user)."""
    out: dict[str, str] = {}
    for part in raw.split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "/data")))
    download_dir: Path = field(default_factory=lambda: Path(_env("DOWNLOAD_DIR", "/downloads")))

    nd_url: str = field(default_factory=lambda: _env("ND_URL", "http://navidrome:4533").rstrip("/"))
    nd_user: str = field(default_factory=lambda: _env("ND_ADMIN_USER"))
    nd_pass: str = field(default_factory=lambda: _env("ND_ADMIN_PASS"))
    # Library id + folder (relative to the library root) where downloads appear in Navidrome
    nd_library_id: int = field(default_factory=lambda: int(_env("ND_LIBRARY_ID", "1")))
    nd_download_prefix: str = field(default_factory=lambda: _env("ND_DOWNLOAD_PREFIX", "Musik-downloads").strip("/"))

    spotbye_url: str = field(default_factory=lambda: _env("SPOTBYE_URL").rstrip("/"))
    spotbye_key: str = field(default_factory=lambda: _env("SPOTBYE_KEY"))

    plex_url: str = field(default_factory=lambda: _env("PLEX_URL").rstrip("/"))
    plex_token: str = field(default_factory=lambda: _env("PLEX_TOKEN"))
    plex_section: str = field(default_factory=lambda: _env("PLEX_SECTION", "2"))
    plex_user_map: dict = field(default_factory=lambda: _user_map(_env("PLEX_USER_MAP")))
    plex_poll_seconds: int = field(default_factory=lambda: int(_env("PLEX_POLL_SECONDS", "120")))
    # Where Plex sees DOWNLOAD_DIR; new downloads trigger a Plex scan of just that folder
    plex_download_path: str = field(
        default_factory=lambda: _env("PLEX_DOWNLOAD_PATH", "/media/Plex/Musik-downloads").rstrip("/"))

    ingest_secret: str = field(default_factory=lambda: _env("INGEST_SECRET"))
    session_secret: str = field(default_factory=lambda: _env("SESSION_SECRET") or secrets.token_hex(32))
    public_name: str = field(default_factory=lambda: _env("HUB_NAME", "Music Hub"))

    @property
    def plex_enabled(self) -> bool:
        return bool(self.plex_url and self.plex_token)

    @property
    def spotbye_enabled(self) -> bool:
        return bool(self.spotbye_url and self.spotbye_key)


settings = Settings()
