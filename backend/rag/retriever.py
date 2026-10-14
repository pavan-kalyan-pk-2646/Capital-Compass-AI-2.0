"""Local compliance RAG — BM25 retrieval over rag/knowledge/*.md. No embeddings API, no keys.

Each `## ID Title` section is one passage. The Compliance Agent retrieves the passages most
relevant to a decision and cites them by ID next to each rule check.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

KB_DIR = Path(__file__).resolve().parent / "knowledge"
_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = {
    "the",
    "a",
    "an",
    "of",
    "to",
    "and",
    "or",
    "is",
    "are",
    "be",
    "in",
    "on",
    "for",
    "at",
    "by",
    "as",
    "it",
    "its",
    "with",
    "than",
    "that",
    "this",
    "must",
    "should",
    "not",
}


@dataclass(frozen=True)
class Passage:
    id: str
    title: str
    text: str
    source: str


def _tokens(s: str) -> list[str]:
    return [t for t in _TOKEN.findall(s.lower()) if t not in _STOP]


@lru_cache(maxsize=1)
def passages() -> tuple[Passage, ...]:
    out = []
    for f in sorted(KB_DIR.glob("*.md")):
        for block in re.split(r"\n(?=## )", f.read_text(encoding="utf-8")):
            m = re.match(r"## (\S+)\s+(.+)\n+(.*)", block.strip(), re.S)
            if m:
                out.append(
                    Passage(m.group(1), m.group(2).strip(), " ".join(m.group(3).split()), f.name)
                )
    return tuple(out)


@lru_cache(maxsize=1)
def _index():
    docs = [_tokens(p.title + " " + p.text) for p in passages()]
    df = Counter(t for d in docs for t in set(d))
    avg = sum(len(d) for d in docs) / max(len(docs), 1)
    return docs, df, avg


def search(query: str, k: int = 4) -> list[dict]:
    docs, df, avg = _index()
    n = len(docs)
    q = _tokens(query)
    k1, b = 1.5, 0.75
    scored = []
    for i, d in enumerate(docs):
        tf = Counter(d)
        s = 0.0
        for t in q:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / avg))
        if s > 0:
            scored.append((s, i))
    scored.sort(reverse=True)
    ps = passages()
    return [
        {
            "id": ps[i].id,
            "title": ps[i].title,
            "text": ps[i].text,
            "source": ps[i].source,
            "score": round(s, 3),
        }
        for s, i in scored[:k]
    ]


def get(passage_id: str) -> dict | None:
    for p in passages():
        if p.id == passage_id:
            return {"id": p.id, "title": p.title, "text": p.text, "source": p.source}
    return None
