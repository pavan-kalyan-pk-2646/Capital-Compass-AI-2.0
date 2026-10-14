"""Demo data: the flagship judge profile and a sample portfolio CSV."""

import json
from functools import lru_cache
from pathlib import Path

from schemas.profile import ProfileInput

DEMO_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def _judge_raw() -> dict:
    return json.loads((DEMO_DIR / "judge_profile.json").read_text(encoding="utf-8"))


def judge_profile() -> ProfileInput:
    return ProfileInput.model_validate(_judge_raw())


def sample_portfolio_csv() -> str:
    return (DEMO_DIR / "sample_portfolio.csv").read_text(encoding="utf-8")
