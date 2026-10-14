"""Market Intelligence: feed parsing, classification, offline fallback and the /api/news endpoint.

No network: every test that reaches the fetcher monkeypatches `news._fetch_url`.
"""

from datetime import datetime, timezone
from pathlib import Path

import pytest

from market import news

FIXTURE = (Path(__file__).parent / "fixtures" / "news_feed.xml").read_bytes()

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fixture Atom Wire</title>
  <entry>
    <title type="html">Unemployment rate falls as hiring picks up</title>
    <link rel="alternate" href="https://example.org/jobs"/>
    <updated>2026-10-07T08:00:00Z</updated>
    <summary type="html">&lt;p&gt;Payrolls &amp;amp; wages rose.&lt;/p&gt;</summary>
  </entry>
</feed>"""


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    news.reset_cache()
    monkeypatch.delenv("NEWS_FEEDS", raising=False)
    monkeypatch.delenv("NEWS_LIVE", raising=False)
    yield
    news.reset_cache()


@pytest.fixture
def news_client():
    """A fresh app instance with the news blueprint registered (app.py is wired separately)."""
    from api import news as news_api
    from app import create_app

    a = create_app()
    if "news" not in a.blueprints:
        a.register_blueprint(news_api.bp)
    return a.test_client()


def _offline(monkeypatch):
    def boom(url, timeout=news.FEED_TIMEOUT):
        raise OSError("network unreachable")

    monkeypatch.setattr(news, "_fetch_url", boom)


# ---------------------------------------------------------------- parsing
def test_parse_rss_fixture():
    title, items = news.parse_feed(FIXTURE, "Fixture", "https://example.com/rss")
    assert title == "Fixture Finance Wire"
    assert len(items) == 5  # empty-title item dropped
    first = items[0]
    assert first["link"] == "https://example.com/news/rate-hike"
    assert first["summary"] == (
        "The monetary policy committee raised the policy rate & signalled caution."
    )
    assert first["published_dt"] == datetime(2026, 10, 6, 4, 0, tzinfo=timezone.utc)
    assert len(items[2]["summary"]) <= news.SUMMARY_LEN and items[2]["summary"].endswith("…")
    assert items[4]["link"] is None  # javascript: links are never passed through


def test_parse_atom():
    title, items = news.parse_feed(ATOM, "", "https://example.org/atom")
    assert title == "Fixture Atom Wire"
    (it,) = items
    assert it["link"] == "https://example.org/jobs"
    assert it["summary"] == "Payrolls & wages rose."
    assert it["published_dt"] == datetime(2026, 10, 7, 8, 0, tzinfo=timezone.utc)
    assert it["source"] == "Fixture Atom Wire"


def test_parse_rejects_entities_and_garbage():
    with pytest.raises(ValueError):
        news.parse_feed(b'<!DOCTYPE x [<!ENTITY a "b">]><rss/>', "x")
    with pytest.raises(ValueError):
        news.parse_feed(b"<html><body>not a feed", "x")


# ---------------------------------------------------------------- classification
def test_rate_story_maps_to_loans():
    c = news.classify("RBI hikes repo rate by 25 bps", "Floating-rate home loan EMIs may rise.")
    assert c["primary_category"] == "interest_rates"
    assert "india" in c["categories"]
    assert "loans" in c["impact"]["domains"]
    paths = {s["path"] for s in c["impact"]["simulators"]}
    assert {"/loan", "/crisis?scenario=rate_hike"} <= paths
    assert c["relevance"] == "high"
    assert "may" in c["impact"]["why"].lower()


def test_inflation_story_maps_to_inflation_and_goals():
    c = news.classify("CPI inflation rises to 6.2% on food prices", "")
    assert c["primary_category"] == "inflation"
    assert {"inflation", "goals"} <= set(c["impact"]["domains"])
    paths = {s["path"] for s in c["impact"]["simulators"]}
    assert {"/crisis?scenario=inflation_spike", "/multiverse", "/goals"} <= paths


def test_market_and_employment_stories():
    m = news.classify("Wall Street stocks tumble in broad sell-off", "")
    assert m["primary_category"] == "markets" and "global" in m["categories"]
    assert m["impact"]["domains"] == ["portfolio"]
    assert {"/portfolio", "/crisis?scenario=market_crash"} <= {
        s["path"] for s in m["impact"]["simulators"]
    }
    j = news.classify("Tech layoffs spread as hiring freezes", "")
    assert j["primary_category"] == "employment"
    assert "/crisis?scenario=job_loss" in {s["path"] for s in j["impact"]["simulators"]}


def test_unrelated_story_is_low_and_honest():
    c = news.classify("Local museum opens a new wing", "", default_region="global")
    assert c["categories"] == ["global"]
    assert c["relevance"] == "low"
    assert c["impact"]["domains"] == [] and c["impact"]["simulators"] == []
    assert c["impact"]["why"] == news.NO_IMPACT_WHY


def test_sample_dataset_is_labelled_and_covers_all_categories():
    items = news.load_sample()
    assert 16 <= len(items) <= 22
    for it in items:
        assert it["demo"] is True
        assert it["source"] == news.SAMPLE_SOURCE
        assert it["published"] is None and it["link"] is None
        assert it["title"].startswith("Illustrative:")
        assert set(it["impact"]["domains"]) <= set(news.DOMAINS)
    covered = {c for it in items for c in it["categories"]}
    assert covered == set(news.CATEGORIES)


# ---------------------------------------------------------------- fetch + fallback
def test_offline_fallback_when_fetcher_raises(monkeypatch):
    _offline(monkeypatch)
    r = news.get_news()
    assert r["mode"] == "offline"
    assert "demo/offline mode" in r["note"]
    assert r["sources"] and all(not s["ok"] and s["error"] for s in r["sources"])
    assert all(i["demo"] for i in r["items"])


def test_live_disabled_by_env(monkeypatch):
    monkeypatch.setenv("NEWS_LIVE", "0")
    calls = []
    monkeypatch.setattr(news, "_fetch_url", lambda *a, **k: calls.append(a) or FIXTURE)
    r = news.get_news()
    assert r["mode"] == "offline" and not calls and r["sources"] == []


def test_live_mode_dedupes_sorts_and_caches(monkeypatch):
    monkeypatch.setenv("NEWS_FEEDS", "https://example.com/a.xml, https://example.org/atom.xml")
    calls = []

    def fake(url, timeout=news.FEED_TIMEOUT):
        calls.append(url)
        return ATOM if "atom" in url else FIXTURE

    monkeypatch.setattr(news, "_fetch_url", fake)
    r = news.get_news()
    assert r["mode"] == "live" and not r["cached"]
    assert [s["count"] for s in r["sources"]] == [5, 1] and all(s["ok"] for s in r["sources"])
    titles = [i["title"] for i in r["items"]]
    assert len(titles) == 5  # one duplicate headline removed
    dates = [i["published"] for i in r["items"] if i["published"]]
    assert dates == sorted(dates, reverse=True)
    assert all(not i["demo"] for i in r["items"])
    assert r["items"][0]["source"] == "Fixture Finance Wire"  # name from channel title
    # cached
    r2 = news.get_news()
    assert r2["cached"] and len(calls) == 2
    # refresh honoured once, then throttled for 60 s
    news.get_news(refresh=True)
    assert len(calls) == 4
    r3 = news.get_news(refresh=True)
    assert r3["refresh_throttled"] and r3["retry_after"] > 0 and len(calls) == 4


def test_partial_failure_still_live(monkeypatch):
    monkeypatch.setenv("NEWS_FEEDS", "https://example.com/a.xml,https://down.example/b.xml")

    def fake(url, timeout=news.FEED_TIMEOUT):
        if "down" in url:
            raise TimeoutError("timed out")
        return FIXTURE

    monkeypatch.setattr(news, "_fetch_url", fake)
    r = news.get_news()
    assert r["mode"] == "live"
    assert [s["ok"] for s in r["sources"]] == [True, False]
    assert "TimeoutError" in r["sources"][1]["error"]


# ---------------------------------------------------------------- API
def test_api_news_offline(news_client, monkeypatch):
    _offline(monkeypatch)
    r = news_client.get("/api/news")
    assert r.status_code == 200, r.json
    j = r.json
    for k in ("mode", "fetched_at", "sources", "categories", "items", "note", "disclaimer"):
        assert k in j
    assert j["mode"] == "offline"
    assert set(j["categories"]) == set(news.CATEGORIES)
    it = j["items"][0]
    for k in (
        "id",
        "title",
        "link",
        "source",
        "published",
        "summary",
        "demo",
        "categories",
        "primary_category",
        "relevance",
        "relevance_score",
        "impact",
    ):
        assert k in it

    r = news_client.get("/api/news?category=inflation")
    assert r.status_code == 200
    assert r.json["items"] and all("inflation" in i["categories"] for i in r.json["items"])
    assert len(r.json["items"]) == r.json["categories"]["inflation"]


def test_api_news_rejects_unknown_category(news_client, monkeypatch):
    _offline(monkeypatch)
    r = news_client.get("/api/news?category=crypto-moonshots")
    assert r.status_code == 422
    assert r.json["details"][0]["field"] == "category"
