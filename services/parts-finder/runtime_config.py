"""Deployment settings for running the module as an internal АН-30 service.

Every value has a default that keeps the original single-folder demo working:
state files next to the code, `.env` next to `proxy.py`, and a server that
answers only on localhost.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8011


def state_dir():
    """Folder for the SQLite state files (FAPI ledger and cache, Groq budget, provider registry)."""
    configured = os.getenv("PARTS_FINDER_STATE_DIR", "").strip()
    return Path(configured) if configured else ROOT


def state_file(name):
    return state_dir() / name


def env_file():
    """Optional dotenv file with provider keys; `.env` next to the code when not configured."""
    configured = os.getenv("PARTS_FINDER_ENV_FILE", "").strip()
    return Path(configured) if configured else ROOT / ".env"


def allowed_hosts(port):
    """Host header values the server answers to (comma list in PARTS_FINDER_ALLOWED_HOSTS)."""
    configured = os.getenv("PARTS_FINDER_ALLOWED_HOSTS", "")
    hosts = {item.strip().lower() for item in configured.split(",") if item.strip()}
    return frozenset(hosts or {f"localhost:{port}", f"127.0.0.1:{port}"})
