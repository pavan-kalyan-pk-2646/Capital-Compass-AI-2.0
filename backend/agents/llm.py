"""Optional LLM polish. OFF by default — the product needs no API key.

LLM_PROVIDER=none   (default) deterministic text only
LLM_PROVIDER=ollama local model at OLLAMA_URL (no key), e.g. llama3.2 / phi3:mini
LLM_PROVIDER=openai needs LLM_API_KEY
The LLM may only rephrase a paragraph that already contains every number; on any error or
timeout the original text is returned.
"""

from __future__ import annotations

import json
import logging
import urllib.request

from config import settings

log = logging.getLogger(__name__)

PROMPT = (
    "Rewrite this financial summary in two clear, plain sentences for the investor. "
    "Keep every number exactly as written. Do not add advice, numbers or guarantees.\n\n"
)


def polish(text: str) -> tuple[str, bool]:
    s = settings()
    if s.llm_provider == "none":
        return text, False
    try:
        if s.llm_provider == "ollama":
            body = json.dumps(
                {"model": s.llm_model or "phi3:mini", "prompt": PROMPT + text, "stream": False}
            ).encode()
            req = urllib.request.Request(
                f"{s.ollama_url}/api/generate",
                data=body,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=s.llm_timeout_s) as r:
                out = json.loads(r.read())["response"].strip()
        elif s.llm_provider == "openai" and s.llm_api_key:
            body = json.dumps(
                {
                    "model": s.llm_model or "gpt-4o-mini",
                    "max_tokens": 200,
                    "messages": [{"role": "user", "content": PROMPT + text}],
                }
            ).encode()
            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {s.llm_api_key}",
                },
            )
            with urllib.request.urlopen(req, timeout=s.llm_timeout_s) as r:
                out = json.loads(r.read())["choices"][0]["message"]["content"].strip()
        else:
            return text, False
        # guard: every number in the original must survive
        import re

        nums = set(re.findall(r"\d[\d,.]*", text))
        if out and all(n in out for n in nums):
            return out, True
        return text, False
    except Exception as exc:  # noqa: BLE001 — any failure falls back to the template
        log.warning("LLM polish skipped: %s", exc)
        return text, False
