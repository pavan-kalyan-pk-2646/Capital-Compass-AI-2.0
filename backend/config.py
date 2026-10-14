"""Settings from environment / .env (repo root or backend/). Every value has a working default,
so the app runs with zero configuration and zero API keys."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
REPO_DIR = BACKEND_DIR.parent
load_dotenv(REPO_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _local_secret() -> str:
    """No SECRET_KEY set: create one once and keep it in backend/.secret_key (git-ignored)."""
    f = BACKEND_DIR / ".secret_key"
    try:
        if f.exists():
            return f.read_text().strip()
        key = secrets.token_hex(32)
        f.write_text(key)
        return key
    except OSError:
        return secrets.token_hex(32)


@dataclass(frozen=True)
class Settings:
    # MySQL in production: mysql+pymysql://user:pass@localhost:3306/capital_compass
    # Falls back to a local SQLite file so the demo always runs.
    database_url: str = field(
        default_factory=lambda: (
            _env("DATABASE_URL") or (f"sqlite:///{(BACKEND_DIR / 'capital_compass.db').as_posix()}")
        )
    )
    secret_key: str = field(default_factory=lambda: _env("SECRET_KEY") or _local_secret())
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "none").lower())
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL"))
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY"))
    ollama_url: str = field(default_factory=lambda: _env("OLLAMA_URL", "http://localhost:11434"))
    llm_timeout_s: float = field(default_factory=lambda: float(_env("LLM_TIMEOUT_S", "8")))
    mc_simulations: int = field(default_factory=lambda: int(_env("MC_SIMULATIONS", "10000")))
    mc_seed: int = field(default_factory=lambda: int(_env("MC_SEED", "42")))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in _env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        )
    )
    port: int = field(default_factory=lambda: int(_env("PORT", "5000")))
    debug: bool = field(default_factory=lambda: _env("FLASK_DEBUG", "0") == "1")

    @property
    def db_kind(self) -> str:
        return "MySQL" if self.database_url.startswith("mysql") else "SQLite (local fallback)"


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings()
