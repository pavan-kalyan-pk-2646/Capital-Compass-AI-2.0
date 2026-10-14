"""Market Intelligence: public RSS/Atom headlines, classified for personal-finance impact.

Sources
-------
Live items come only from fetched public RSS 2.0 / Atom feeds (no keys, no paid APIs, stdlib
only). Each item keeps its real source name, link and published date; we store only the
headline, link, source, date and a short plain-text summary (HTML stripped, ~280 chars) and
always link out to the original article.

    NEWS_FEEDS   comma-separated feed URLs (overrides DEFAULT_FEEDS)
    NEWS_LIVE=0  disables live fetching (always serves the offline sample)

Feeds are fetched concurrently (one thread each, FEED_TIMEOUT = 4 s, browser-like User-Agent,
responses capped at 2 MB and refused if they declare a DOCTYPE/ENTITY). Results are cached in
memory for CACHE_TTL = 15 min (an all-failed result only for OFFLINE_TTL = 2 min), deduped by
normalised title and capped at MAX_ITEMS = 60, newest first. A forced refresh is honoured at
most once per REFRESH_MIN_INTERVAL = 60 s.

If every feed fails, the payload has mode "offline" and serves the bundled illustrative dataset
(`data/news_sample.json`): every item has demo=true, source "Capital Compass sample dataset",
published=null and no link. It describes generic situations, never real current events.

Classification (deterministic keyword rules)
-------------------------------------------
Text = lower-cased headline + summary. A category matches when any of its regex patterns
(CATEGORY_PATTERNS) hits. Hits in the headline count 2, in the summary 1.

* Region: "india" if an India pattern hits; else "global" if a global pattern hits; else the
  feed's default region (RBI/ET/Mint/Moneycontrol → india, BBC → global; unknown → global).
* Topical categories: markets, economy, interest_rates, inflation, employment, technology,
  sectors, policy. An item can have several.
* Primary category = the matched topical category with the most weighted hits (ties →
  higher CATEGORY_WEIGHT, then CATEGORIES order); if none matched, the region.
* "top" (top stories) = the TOP_N items with the highest  score + recency bonus
  (+15 if published < 24 h ago, +5 if < 72 h), ties broken by recency. Assigned per batch.

Relevance score (0–100), weighted by importance to personal finance:

    score = Σ CATEGORY_WEIGHT[c] over matched categories
          + 4 × min(extra_hits, 3)            (extra_hits = total weighted hits − matched cats)
          + 10 if a household-finance term hits (EMI, home loan, SIP, mutual fund, FD, tax …)
    score = min(score, 100);  level = high ≥ 60, medium ≥ 30, else low

Impact mapping
--------------
domains ⊆ {loans, goals, portfolio, liquidity, inflation}, from categories:

    interest_rates → loans, liquidity     inflation → inflation, goals
    markets        → portfolio            employment → liquidity, goals
    economy        → portfolio            sectors/technology → portfolio
    policy         → portfolio (+ loans if lending terms, + goals if tax/pension terms)

plus keyword triggers: lending terms → loans, deposit/cash terms → liquidity. "why" joins the
conditional sentences (IMPACT_WHY) of the first two impact-bearing categories — it describes
what *may* be affected, never a prediction. "simulators" link to app pages where the user can
test the effect (SIMULATORS). Items with no mapped domain say so plainly.
"""

from __future__ import annotations

import email.utils
import hashlib
import html
import json
import logging
import os
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

log = logging.getLogger(__name__)

DATA = Path(__file__).resolve().parent / "data" / "news_sample.json"

FEED_TIMEOUT = 4.0
CACHE_TTL = 15 * 60
OFFLINE_TTL = 2 * 60
REFRESH_MIN_INTERVAL = 60
MAX_ITEMS = 60
MAX_BYTES = 2 * 1024 * 1024
SUMMARY_LEN = 280
TOP_N = 12
SAMPLE_SOURCE = "Capital Compass sample dataset"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36 CapitalCompass/2.0"
)

# (url, display name, default region)
DEFAULT_FEEDS: list[tuple[str, str, str]] = [
    ("https://www.rbi.org.in/pressreleases_rss.xml", "RBI press releases", "india"),
    (
        "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
        "The Economic Times — Markets",
        "india",
    ),
    (
        "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms",
        "The Economic Times — Economy",
        "india",
    ),
    ("https://www.livemint.com/rss/markets", "Mint — Markets", "india"),
    ("https://www.livemint.com/rss/economy", "Mint — Economy", "india"),
    ("https://www.moneycontrol.com/rss/business.xml", "Moneycontrol — Business", "india"),
    ("https://feeds.bbci.co.uk/news/business/rss.xml", "BBC News — Business", "global"),
]

CATEGORIES = [
    "top",
    "india",
    "global",
    "markets",
    "economy",
    "interest_rates",
    "inflation",
    "employment",
    "technology",
    "sectors",
    "policy",
]
REGIONS = ("india", "global")
TOPICAL = [c for c in CATEGORIES if c not in ("top", *REGIONS)]

CATEGORY_WEIGHT = {
    "interest_rates": 30,
    "inflation": 28,
    "employment": 24,
    "markets": 20,
    "policy": 20,
    "economy": 16,
    "sectors": 10,
    "technology": 8,
    "india": 8,
    "global": 4,
}

_P = {
    "india": [
        r"\bindia(n|'s)?\b",
        r"\brbi\b",
        r"\breserve bank of india\b",
        r"\bsebi\b",
        r"\bnifty\b",
        r"\bsensex\b",
        r"\brupee\b",
        r"₹",
        r"\bnse\b",
        r"\bbse\b",
        r"\bgst\b",
        r"\bmumbai\b",
        r"\bdelhi\b",
        r"\bnew delhi\b",
        r"\bcrore\b",
        r"\blakh\b",
        r"\bunion budget\b",
        r"\bfinance minist(er|ry)\b",
        r"\bnirmala\b",
        r"\bepfo\b",
        r"\bmospi\b",
        r"\birdai\b",
        r"\bpfrda\b",
        r"\bupi\b",
    ],
    "global": [
        r"\bfed\b",
        r"\bfederal reserve\b",
        r"\becb\b",
        r"\bbank of england\b",
        r"\bbank of japan\b",
        r"\bwall street\b",
        r"\bs&p 500\b",
        r"\bnasdaq\b",
        r"\bdow\b",
        r"\bu\.s\.",
        r"\bus (fed|economy|inflation|jobs|stocks|treasury|dollar|tariffs?|markets?)\b",
        r"\bunited states\b",
        r"\bchina\b",
        r"\beuro(pe|zone|pean)?\b",
        r"\buk\b",
        r"\bbritain\b",
        r"\bjapan\b",
        r"\bimf\b",
        r"\bworld bank\b",
        r"\bopec\b",
        r"\bglobal\b",
        r"\bdollar\b",
        r"\btreasur(y|ies)\b",
    ],
    "markets": [
        r"\bstocks?\b",
        r"\bshares?\b",
        r"\bequit(y|ies)\b",
        r"(?<!job )(?<!labour )\bmarkets?\b",
        r"\bnifty\b",
        r"\bsensex\b",
        r"\bindices\b",
        r"\bindex\b",
        r"\brally\b",
        r"\bsell-?off\b",
        r"\bipo\b",
        r"\bmutual funds?\b",
        r"\bsip\b",
        r"\binvestors?\b",
        r"\bfpis?\b",
        r"\bfiis?\b",
        r"\bbonds?\b",
        r"\bgold prices?\b",
        r"\bcrude\b",
        r"\bvolatil",
        r"\bwall street\b",
        r"\bs&p 500\b",
        r"\bnasdaq\b",
        r"\bcorrection\b",
        r"\bbull\b",
        r"\bbear\b",
        r"\bdrawdown\b",
    ],
    "economy": [
        r"\bgdp\b",
        r"\beconom(y|ic|ies)\b",
        r"\bgrowth\b",
        r"\brecession\b",
        r"\bslowdown\b",
        r"\bfiscal deficit\b",
        r"\bcurrent account\b",
        r"\btrade deficit\b",
        r"\bexports?\b",
        r"\bimports?\b",
        r"\bmanufacturing\b",
        r"\bpmi\b",
        r"\bindustrial output\b",
        r"\biip\b",
        r"\bconsumption\b",
        r"\bdemand\b",
        r"\bforex reserves\b",
        r"\bbudget\b",
    ],
    "interest_rates": [
        r"\binterest rates?\b",
        r"\brepo rate\b",
        r"\breverse repo\b",
        r"\bpolicy rates?\b",
        r"\brate (hike|cut|increase|decrease)s?\b",
        r"\b(hikes?|cuts?|raises?|lowers?|holds?|"
        r"keeps?) (the )?(key |policy |interest |repo |benchmark )?(lending )?rates?\b",
        r"\bmonetary policy\b",
        r"\bmpc\b",
        r"\bbasis points?\b",
        r"\b\d+\s?bps\b",
        r"\bfed funds\b",
        r"\bbond yields?\b",
        r"\byields?\b",
        r"\bmclr\b",
        r"\blending rates?\b",
        r"\bdeposit rates?\b",
        r"\bfd rates?\b",
        r"\bhome loan rates?\b",
        r"\bcentral bank\b",
        r"\btightening\b",
        r"\beasing\b",
    ],
    "inflation": [
        r"\binflation\b",
        r"\bcpi\b",
        r"\bwpi\b",
        r"\bconsumer prices?\b",
        r"\bretail prices?\b",
        r"\bprice rise\b",
        r"\bcost of living\b",
        r"\bfood prices?\b",
        r"\bfuel prices?\b",
        r"\bdeflation\b",
        r"\bpurchasing power\b",
        r"\bprices (rise|rose|"
        r"climb|surge|jump)",
        r"\bdearness allowance\b",
    ],
    "employment": [
        r"\bjobs?\b",
        r"\bemployment\b",
        r"\bunemployment\b",
        r"\bjobless\b",
        r"\blayoffs?\b",
        r"\blaid off\b",
        r"\bhiring\b",
        r"\bpayrolls?\b",
        r"\bwages?\b",
        r"\bsalar(y|ies)\b",
        r"\blabou?r market\b",
        r"\bworkforce\b",
        r"\bplfs\b",
        r"\bepfo\b",
        r"\bjob cuts?\b",
        r"\bjob losses\b",
    ],
    "technology": [
        r"\btech(nology)?\b",
        r"\bai\b",
        r"\bartificial intelligence\b",
        r"\bsoftware\b",
        r"\bsemiconductors?\b",
        r"\bchips?\b",
        r"\bfintech\b",
        r"\bdigital\b",
        r"\bupi\b",
        r"\bstartups?\b",
        r"\bit services\b",
        r"\bit sector\b",
        r"\bcyber",
        r"\bcrypto",
        r"\bdata cent(er|re)s?\b",
    ],
    "sectors": [
        r"(?<!central )\bbanks?\b",
        r"\bbanking\b",
        r"\bnbfcs?\b",
        r"\bauto(mobile|mobiles|makers?)?\b",
        r"\bpharma(ceuticals?)?\b",
        r"\breal estate\b",
        r"\brealty\b",
        r"\bhousing\b",
        r"\bfmcg\b",
        r"\bmetals?\b",
        r"\bsteel\b",
        r"\boil and gas\b",
        r"\benergy\b",
        r"\bpower (sector|companies|utilities)\b",
        r"\btelecom\b",
        r"\binfrastructure\b",
        r"\bsector(s|al)?\b",
        r"\binsurers?\b",
        r"\binsurance\b",
        r"\bairlines?\b",
        r"\bcement\b",
    ],
    "policy": [
        r"\bpolicy\b",
        r"\bregulat(or|ors|ion|ions|ory)\b",
        r"\bsebi\b",
        r"\birdai\b",
        r"\bpfrda\b",
        r"\bcircular\b",
        r"\bguidelines?\b",
        r"\bframework\b",
        r"\btax(es|ation)?\b",
        r"\bgst\b",
        r"\bbudget\b",
        r"\bfiscal\b",
        r"\bfinance minist(er|ry)\b",
        r"\bnorms?\b",
        r"\brules?\b",
        r"\bkyc\b",
        r"\bmonetary policy\b",
        r"\bpress release\b",
        r"\bdirections?\b",
        r"\bpenalty\b",
        r"\bcompliance\b",
    ],
}
CATEGORY_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    k: [re.compile(p) for p in v] for k, v in _P.items()
}

HOUSEHOLD = re.compile(
    r"\b(emis?|home loans?|personal loans?|car loans?|loan|sips?|mutual funds?|fixed deposits?|"
    r"fds?|savings|income tax|tax|pension|ppf|nps|epf|retire(ment)?|credit cards?|"
    r"insurance)\b"
)
LENDING = re.compile(
    r"\b(loans?|emis?|lending|borrow(ing|ers?)?|credit|mclr|repo|mortgages?|nbfcs?)\b"
)
LIQUIDITY = re.compile(
    r"\b(deposits?|fds?|savings|liquidity|cash|emergency fund|withdrawals?|bank account)\b"
)
GOALS_TERMS = re.compile(r"\b(tax|pension|retire(ment)?|education|ppf|nps|epf|housing prices)\b")

DOMAINS = ["loans", "goals", "portfolio", "liquidity", "inflation"]

CATEGORY_DOMAINS: dict[str, list[str]] = {
    "interest_rates": ["loans", "liquidity"],
    "inflation": ["inflation", "goals"],
    "markets": ["portfolio"],
    "employment": ["liquidity", "goals"],
    "economy": ["portfolio"],
    "sectors": ["portfolio"],
    "technology": ["portfolio"],
    "policy": ["portfolio"],
}

IMPACT_WHY = {
    "interest_rates": "Interest-rate changes may influence borrowing costs, EMIs on "
    "floating-rate loans and the returns available on deposits and bonds.",
    "inflation": "Rising or falling prices can change your real purchasing power and may raise "
    "the future cost of your goals.",
    "employment": "Job-market conditions can affect income stability and how long an emergency "
    "fund may need to last.",
    "markets": "Market moves can affect the value of equity and debt holdings; a swing matters "
    "most if you may need to sell soon.",
    "policy": "Changes to financial rules, taxes or regulation can affect the costs, returns or "
    "eligibility of products you use.",
    "economy": "Broad economic conditions can influence incomes, company earnings and market "
    "sentiment over time.",
    "sectors": "Sector-level news can affect funds or stocks concentrated in that industry.",
    "technology": "Technology-sector developments can affect tech-heavy funds and, over time, "
    "jobs in the sector.",
}
NO_IMPACT_WHY = (
    "General context. The keyword rules found no direct link to loans, goals, portfolio, "
    "liquidity or inflation."
)

SIMULATORS: dict[str, list[dict[str, str]]] = {
    "loans": [{"label": "Loan simulator", "path": "/loan"}],
    "rates": [{"label": "Rate-hike stress test", "path": "/crisis?scenario=rate_hike"}],
    "inflation": [
        {"label": "Inflation-spike stress test", "path": "/crisis?scenario=inflation_spike"},
        {"label": "Multiverse futures", "path": "/multiverse"},
    ],
    "portfolio": [
        {"label": "Market-crash stress test", "path": "/crisis?scenario=market_crash"},
        {"label": "Portfolio doctor", "path": "/portfolio"},
    ],
    "employment": [{"label": "Job-loss stress test", "path": "/crisis?scenario=job_loss"}],
    "goals": [{"label": "Goal survival", "path": "/goals"}],
}


# ---------------------------------------------------------------- text helpers
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean_text(raw: str | None, limit: int | None = None) -> str:
    """HTML → plain text (entities decoded, tags stripped, whitespace collapsed), truncated."""
    if not raw:
        return ""
    s = html.unescape(raw)
    s = _TAG.sub(" ", s)
    s = html.unescape(s)
    s = _WS.sub(" ", s).strip()
    if limit and len(s) > limit:
        cut = s[: limit - 1]
        if " " in cut[limit // 2 :]:
            cut = cut[: cut.rfind(" ")]
        s = cut.rstrip(" ,;:.-") + "…"
    return s


def normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def _safe_link(link: str | None) -> str | None:
    if not link:
        return None
    link = link.strip()
    return link if urlparse(link).scheme in ("http", "https") else None


def parse_date(raw: str | None) -> datetime | None:
    """RFC 822 (RSS) or ISO 8601 (Atom) → aware UTC datetime, or None."""
    if not raw:
        return None
    raw = raw.strip()
    try:
        d = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        d = None
    if d is None:
        try:
            d = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _iso(d: datetime | None) -> str | None:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def _item_id(title: str) -> str:
    return hashlib.sha1(normalize_title(title).encode()).hexdigest()[:12]


# ---------------------------------------------------------------- parsing
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child_text(el: ET.Element, *names: str) -> str | None:
    for c in el:
        if _local(c.tag) in names and (c.text or "").strip():
            return c.text
    return None


def _atom_link(el: ET.Element) -> str | None:
    fallback = None
    for c in el:
        if _local(c.tag) == "link":
            href = c.get("href") or (c.text or "").strip() or None
            if c.get("rel", "alternate") == "alternate" and href:
                return href
            fallback = fallback or href
    return fallback


def parse_feed(raw: bytes, source: str, source_url: str = "") -> tuple[str | None, list[dict]]:
    """Parse RSS 2.0 / RSS 1.0 / Atom bytes → (channel title, raw items). Raises ValueError."""
    head = raw[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in raw.lower():
        raise ValueError("feed declares a DOCTYPE/ENTITY; refused")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError(f"not valid XML: {exc}") from exc

    channel_title = None
    entries: list[ET.Element] = []
    for el in root.iter():
        name = _local(el.tag)
        if name in ("item", "entry"):
            entries.append(el)
        elif name in ("channel", "feed") and channel_title is None:
            channel_title = clean_text(_child_text(el, "title")) or None
    if _local(root.tag) == "feed" and channel_title is None:
        channel_title = clean_text(_child_text(root, "title")) or None

    out = []
    for e in entries:
        title = clean_text(_child_text(e, "title"))
        if not title:
            continue
        link = _child_text(e, "link") if _local(e.tag) == "item" else None
        link = _safe_link(link or _atom_link(e) or _child_text(e, "guid"))
        published = parse_date(_child_text(e, "pubdate", "published", "updated", "date"))
        summary = clean_text(
            _child_text(e, "description", "summary", "content", "encoded"), SUMMARY_LEN
        )
        out.append(
            {
                "title": title,
                "link": link,
                "source": source or channel_title or urlparse(source_url).netloc,
                "source_url": source_url,
                "published_dt": published,
                "summary": summary,
            }
        )
    return channel_title, out


# ---------------------------------------------------------------- classification
def _hits(text: str, pats: list[re.Pattern[str]]) -> int:
    return sum(1 for p in pats if p.search(text))


def classify(title: str, summary: str = "", default_region: str = "global") -> dict:
    """Deterministic keyword classification → categories, primary, relevance, impact."""
    t, s = title.lower(), (summary or "").lower()
    weighted: dict[str, int] = {}
    for cat, pats in CATEGORY_PATTERNS.items():
        w = 2 * _hits(t, pats) + _hits(s, pats)
        if w:
            weighted[cat] = w

    if "india" in weighted:
        region = "india"
    elif "global" in weighted:
        region = "global"
    else:
        region = default_region if default_region in REGIONS else "global"
    topical = [c for c in TOPICAL if c in weighted]
    primary = (
        sorted(topical, key=lambda c: (-weighted[c], -CATEGORY_WEIGHT[c], TOPICAL.index(c)))[0]
        if topical
        else region
    )
    cats = [region, *topical]

    text = f"{t} {s}"
    extra = sum(weighted.values()) - len(weighted)
    score = sum(CATEGORY_WEIGHT[c] for c in cats) + 4 * min(max(extra, 0), 3)
    if HOUSEHOLD.search(text):
        score += 10
    score = min(score, 100)
    level = "high" if score >= 60 else "medium" if score >= 30 else "low"

    return {
        "categories": cats,
        "primary_category": primary,
        "relevance": level,
        "relevance_score": score,
        "impact": impact_for(topical, text, primary),
    }


def impact_for(topical: list[str], text: str, primary: str) -> dict:
    domains: list[str] = []
    for c in topical:
        for d in CATEGORY_DOMAINS.get(c, []):
            if d not in domains:
                domains.append(d)
    if "policy" in topical:
        if LENDING.search(text) and "loans" not in domains:
            domains.append("loans")
        if GOALS_TERMS.search(text) and "goals" not in domains:
            domains.append("goals")
    if topical and LENDING.search(text) and "loans" not in domains and "markets" not in topical:
        domains.append("loans")
    if topical and LIQUIDITY.search(text) and "liquidity" not in domains:
        domains.append("liquidity")
    domains = [d for d in DOMAINS if d in domains]

    order = sorted(topical, key=lambda c: (c != primary, -CATEGORY_WEIGHT[c]))
    why_parts = [IMPACT_WHY[c] for c in order if c in IMPACT_WHY][:2]
    why = " ".join(why_parts) if domains else NO_IMPACT_WHY

    keys: list[str] = []
    if "loans" in domains:
        keys.append("loans")
    if "interest_rates" in topical:
        keys.append("rates")
    if "inflation" in domains:
        keys.append("inflation")
    if "portfolio" in domains:
        keys.append("portfolio")
    if "employment" in topical:
        keys.append("employment")
    if "goals" in domains:
        keys.append("goals")
    sims: list[dict[str, str]] = []
    for k in keys:
        for sim in SIMULATORS[k]:
            if sim not in sims:
                sims.append(sim)
    return {"domains": domains, "why": why, "simulators": sims}


def _finish(raw_items: list[dict], *, demo: bool, now: datetime) -> list[dict]:
    """Classify, dedupe, sort newest first, cap, and mark top stories."""
    seen: set[str] = set()
    items: list[dict] = []
    for r in raw_items:
        key = normalize_title(r["title"])
        if not key or key in seen:
            continue
        seen.add(key)
        c = classify(r["title"], r.get("summary", ""), r.get("region", "global"))
        d = r.get("published_dt")
        items.append(
            {
                "id": r.get("id") or _item_id(r["title"]),
                "title": r["title"],
                "link": None if demo else r.get("link"),
                "source": r["source"],
                "source_url": r.get("source_url") or None,
                "published": _iso(d),
                "summary": r.get("summary", ""),
                "demo": demo,
                **c,
                "_ts": d.timestamp() if d else None,
            }
        )
    if not demo:
        items.sort(key=lambda i: -(i["_ts"] or 0))
    items = items[:MAX_ITEMS]

    def rank(i: dict) -> tuple[float, float]:
        bonus = 0
        if i["_ts"] is not None:
            age_h = (now.timestamp() - i["_ts"]) / 3600
            bonus = 15 if age_h < 24 else 5 if age_h < 72 else 0
        return (i["relevance_score"] + bonus, i["_ts"] or 0)

    for i in sorted(items, key=rank, reverse=True)[:TOP_N]:
        i["categories"] = ["top", *i["categories"]]
    for i in items:
        del i["_ts"]
    return items


# ---------------------------------------------------------------- fetching
def configured_feeds() -> list[tuple[str, str, str]]:
    env = os.environ.get("NEWS_FEEDS", "").strip()
    if not env:
        return list(DEFAULT_FEEDS)
    known = {u: (n, r) for u, n, r in DEFAULT_FEEDS}
    out = []
    for u in (x.strip() for x in env.split(",")):
        if _safe_link(u):
            n, r = known.get(u, ("", "global"))
            out.append((u, n, r))
    return out


def live_enabled() -> bool:
    return os.environ.get("NEWS_LIVE", "1").strip().lower() not in ("0", "false", "no", "off")


def _fetch_url(url: str, timeout: float = FEED_TIMEOUT) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (http/https only)
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("feed larger than 2 MB; refused")
    return data


def _short_error(exc: BaseException) -> str:
    msg = str(getattr(exc, "reason", "") or exc) or exc.__class__.__name__
    return f"{exc.__class__.__name__}: {msg}"[:160]


def fetch_all(feeds: list[tuple[str, str, str]]) -> tuple[list[dict], list[dict]]:
    """Fetch every feed concurrently. Returns (raw items, per-source status)."""
    results: dict[str, Any] = {}

    def work(url: str, name: str, region: str) -> None:
        try:
            raw = _fetch_url(url, FEED_TIMEOUT)
            title, items = parse_feed(raw, name, url)
            for it in items:
                it["region"] = region
                if not name and title:
                    it["source"] = title
            results[url] = (name or title or urlparse(url).netloc, items, None)
        except Exception as exc:  # noqa: BLE001 — any failure just marks the source
            results[url] = (name or urlparse(url).netloc, [], _short_error(exc))

    threads = [
        threading.Thread(target=work, args=f, daemon=True, name=f"news:{f[0][:40]}") for f in feeds
    ]
    for t in threads:
        t.start()
    deadline = time.monotonic() + FEED_TIMEOUT + 1.5
    for t in threads:
        t.join(max(0.0, deadline - time.monotonic()))

    items: list[dict] = []
    sources: list[dict] = []
    for url, name, _region in feeds:
        res = results.get(url)
        if res is None:
            sources.append(
                {
                    "name": name or urlparse(url).netloc,
                    "url": url,
                    "ok": False,
                    "error": "timed out",
                    "count": 0,
                }
            )
            continue
        nm, its, err = res
        src = {"name": nm, "url": url, "ok": err is None, "count": len(its)}
        if err:
            src["error"] = err
        sources.append(src)
        items.extend(its)
    return items, sources


# ---------------------------------------------------------------- sample dataset
def load_sample() -> list[dict]:
    rows = json.loads(DATA.read_text(encoding="utf-8"))
    raw = [
        {
            "id": r["id"],
            "title": r["title"],
            "summary": r.get("summary", ""),
            "source": SAMPLE_SOURCE,
            "region": r.get("region", "global"),
            "published_dt": None,
        }
        for r in rows
    ]
    return _finish(raw, demo=True, now=datetime.now(timezone.utc))


# ---------------------------------------------------------------- cache + public API
_lock = threading.Lock()
_cache: dict[str, Any] = {"payload": None, "at": 0.0, "ttl": 0.0}
_last_refresh = 0.0


def reset_cache() -> None:
    global _last_refresh
    with _lock:
        _cache.update(payload=None, at=0.0, ttl=0.0)
        _last_refresh = 0.0


def _build() -> dict:
    now = datetime.now(timezone.utc)
    feeds = configured_feeds()
    sources: list[dict] = []
    items: list[dict] = []
    reason = ""
    if not live_enabled():
        reason = "Live fetching is disabled (NEWS_LIVE=0)."
    elif not feeds:
        reason = "No news feeds are configured (NEWS_FEEDS)."
    else:
        raw, sources = fetch_all(feeds)
        items = _finish(raw, demo=False, now=now)
        if not items:
            reason = "None of the public news feeds could be reached."

    if items:
        ok_n = sum(1 for s in sources if s["ok"] and s["count"])
        mode = "live"
        note = (
            f"Live headlines from {ok_n} public feed{'s' if ok_n != 1 else ''}. Each links to "
            "the original article. Classification and impact notes are keyword-based context, "
            "not predictions."
        )
    else:
        mode = "offline"
        items = load_sample()
        note = (
            f"Market Intelligence is operating in demo/offline mode. {reason} Showing an "
            "illustrative sample dataset, not current news."
        )
    return {
        "mode": mode,
        "fetched_at": _iso(now),
        "sources": sources,
        "items": items,
        "note": note,
    }


def get_news(category: str | None = None, refresh: bool = False) -> dict:
    """Cached news payload, optionally filtered to one category."""
    global _last_refresh
    now = time.monotonic()
    throttled = False
    with _lock:
        payload = _cache["payload"]
        fresh = payload is not None and now - _cache["at"] < _cache["ttl"]
        if refresh and payload is not None:
            if now - _last_refresh >= REFRESH_MIN_INTERVAL:
                fresh = False
            else:
                throttled = True
        if not fresh:
            payload = _build()
            _cache.update(
                payload=payload,
                at=time.monotonic(),
                ttl=CACHE_TTL if payload["mode"] == "live" else OFFLINE_TTL,
            )
            if refresh:
                _last_refresh = time.monotonic()
            cached = False
        else:
            cached = True
        retry_after = max(0, int(REFRESH_MIN_INTERVAL - (time.monotonic() - _last_refresh)))
        if _last_refresh == 0.0:
            retry_after = 0

    counts = {c: 0 for c in CATEGORIES}
    for it in payload["items"]:
        for c in it["categories"]:
            counts[c] += 1
    items = payload["items"]
    if category and category != "all":
        items = [i for i in items if category in i["categories"]]
    return {
        "mode": payload["mode"],
        "fetched_at": payload["fetched_at"],
        "sources": payload["sources"],
        "categories": counts,
        "items": items,
        "note": payload["note"],
        "cached": cached,
        "refresh_throttled": throttled,
        "retry_after": retry_after,
    }
