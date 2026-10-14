"""Capital Compass AI 2.0 — Flask application.

Run (dev):   python app.py            → http://localhost:5000  (API)
Frontend:    cd ../frontend && npm run dev → http://localhost:5173 (proxies /api here)
Production:  npm run build in frontend/, then python app.py serves the built UI too.
"""

from __future__ import annotations

import logging
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from api import auth, decisions, meta, modules, news, profile
from api.common import ApiError
from config import settings
from db.session import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("capital_compass")

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app() -> Flask:
    s = settings()
    app = Flask(__name__, static_folder=None)
    app.config.update(
        SECRET_KEY=s.secret_key, JSON_SORT_KEYS=False, MAX_CONTENT_LENGTH=2 * 1024 * 1024
    )
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    CORS(app, resources={r"/api/*": {"origins": list(s.cors_origins)}})

    for bp in (meta.bp, auth.bp, profile.bp, modules.bp, decisions.bp, news.bp):
        app.register_blueprint(bp)

    @app.errorhandler(ApiError)
    def _api_error(e: ApiError):
        payload = {"error": e.message}
        if e.details:
            payload["details"] = e.details
        return jsonify(payload), e.status

    @app.errorhandler(HTTPException)
    def _http_error(e: HTTPException):
        return jsonify({"error": e.description or e.name}), e.code

    @app.errorhandler(ValueError)
    def _value_error(e: ValueError):
        return jsonify({"error": str(e)}), 422

    @app.errorhandler(Exception)
    def _unhandled(e: Exception):
        log.exception("Unhandled error")
        return jsonify({"error": "Something went wrong on the server. Please try again."}), 500

    # Serve the built React app (single-port mode) when frontend/dist exists
    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path: str):
        if path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        if DIST.exists():
            target = DIST / path
            if path and target.is_file():
                return send_from_directory(DIST, path)
            return send_from_directory(DIST, "index.html")
        return jsonify(
            {
                "service": "Capital Compass AI 2.0 API",
                "hint": "Run the frontend with `npm run dev` in frontend/ "
                "(http://localhost:5173) or build it with `npm run build`.",
            }
        )

    init_db()
    return app


app = create_app()

if __name__ == "__main__":
    s = settings()
    log.info(
        "Capital Compass AI 2.0 on http://localhost:%s (database: %s, LLM: %s)",
        s.port,
        s.db_kind,
        s.llm_provider,
    )
    app.run(host="0.0.0.0", port=s.port, debug=s.debug, threaded=True)
