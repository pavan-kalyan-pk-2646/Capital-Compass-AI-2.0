"""Market Intelligence: public RSS headlines classified for personal-finance impact.

GET /api/news?category=<cat>&refresh=1
    category  optional, one of market.news.CATEGORIES (or "all")
    refresh   "1"/"true" bypasses the 15-min cache, at most once per 60 s

Live headlines come only from public feeds; if none can be reached the payload is
mode="offline" with the clearly labelled illustrative sample dataset.
"""

from __future__ import annotations

from flask import Blueprint, request

from api.common import ApiError, ok
from market import news

bp = Blueprint("news", __name__)


@bp.get("/api/news")
def get_news():
    category = (request.args.get("category") or "").strip().lower() or None
    if category is not None and category != "all" and category not in news.CATEGORIES:
        raise ApiError(
            "Unknown news category",
            422,
            [
                {
                    "field": "category",
                    "message": f"must be one of: all, {', '.join(news.CATEGORIES)}",
                }
            ],
        )
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    return ok(news.get_news(category, refresh=refresh))
