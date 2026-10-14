import os
import tempfile
from pathlib import Path

import pytest

# Isolated SQLite DB for the test session — set before the app/config import.
os.environ["DATABASE_URL"] = f"sqlite:///{(Path(tempfile.mkdtemp()) / 'test.db').as_posix()}"
os.environ["LLM_PROVIDER"] = "none"

from app import app  # noqa: E402
from demo import judge_profile  # noqa: E402

GUEST_KEY = "test-guest-0000-0000-000000000001"


@pytest.fixture(scope="session")
def client():
    """The app as one guest browser: every request carries that browser's guest key."""
    c = app.test_client()
    c.environ_base["HTTP_X_GUEST_KEY"] = GUEST_KEY
    return c


@pytest.fixture
def fresh_client():
    """A client with no guest key and no token (a stranger)."""
    return app.test_client()


@pytest.fixture
def judge():
    return judge_profile().model_copy(deep=True)


@pytest.fixture
def judge_json(judge):
    return judge.model_dump(mode="json")
