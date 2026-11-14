"""Local JSON HTTP API for the browser studio (``127.0.0.1:8765`` by default).

Endpoints (see ``docs/CONTRACTS.md``)::

    GET  /api/health    GET /api/model    GET /api/domain    GET /api/examples
    POST /api/predict   {case, include_field?, force_fem?, include_mesh?}
    POST /api/verify    {case, prediction?, include_field?, include_mesh?, mesh_preset?}
    POST /api/optimize  {case, variables, objective?, constraints?, budget?, seed?}
    POST /api/convergence {case, presets?, probes?}

With ``--static DIR`` the built web app is served from the same origin. The server binds to
loopback only; it is a local development service, not a hardened deployment.
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from physix_mcp.service import PhysixService

log = logging.getLogger("physix")
MAX_BODY = 2_000_000


def _status_for(payload: dict[str, Any]) -> int:
    err = payload.get("error")
    if not err:
        return HTTPStatus.OK
    if err in ("invalid_case", "unsupported_case", "invalid_request", "case_mismatch"):
        return HTTPStatus.UNPROCESSABLE_ENTITY
    return HTTPStatus.INTERNAL_SERVER_ERROR


def make_handler(service: PhysixService, static: Path | None) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "physix-http/1"

        def log_message(self, fmt: str, *args: Any) -> None:  # stderr, compact
            log.info("%s %s", self.address_string(), fmt % args)

        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            if origin:
                host = urlparse(origin).hostname or ""
                if host in ("localhost", "127.0.0.1", "::1"):
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
            body = json.dumps(payload, allow_nan=False, default=_default).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(HTTPStatus.NO_CONTENT)
            self._cors()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            routes = {
                "/api/health": service.health,
                "/api/model": service.model_card,
                "/api/domain": service.describe_domain,
                "/api/examples": service.examples,
            }
            if path in routes:
                self._json(_clean(routes[path]()))
                return
            if path.startswith("/api/"):
                self._json({"error": "not_found", "message": path}, HTTPStatus.NOT_FOUND)
                return
            self._static(path)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                self._json(
                    {"error": "invalid_request", "message": "body size"}, 413 if length else 400
                )
                return
            try:
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("body must be a JSON object")
            except ValueError as exc:
                self._json(
                    {"error": "invalid_request", "message": str(exc)}, HTTPStatus.BAD_REQUEST
                )
                return
            t0 = time.perf_counter()
            if path == "/api/predict":
                out = service.predict(
                    body.get("case"),
                    include_field=bool(body.get("include_field")),
                    force_fem=bool(body.get("force_fem")),
                    include_mesh=bool(body.get("include_mesh")),
                )
            elif path == "/api/verify":
                out = service.verify(
                    body.get("case"),
                    prediction=body.get("prediction"),
                    include_field=bool(body.get("include_field")),
                    include_mesh=bool(body.get("include_mesh")),
                    mesh_preset=body.get("mesh_preset"),
                )
            elif path == "/api/convergence":
                out = service.convergence(
                    body.get("case"), presets=body.get("presets"), probes=body.get("probes")
                )
            elif path == "/api/optimize":
                out = service.optimize(body)
            else:
                self._json({"error": "not_found", "message": path}, HTTPStatus.NOT_FOUND)
                return
            out = _clean(out)
            if isinstance(out, dict) and "error" not in out:
                out.setdefault("timing", {})["http_ms"] = 1e3 * (time.perf_counter() - t0)
            self._json(out, _status_for(out))

        def _static(self, path: str) -> None:
            if static is None:
                self._json({"error": "not_found", "message": "no static directory"}, 404)
                return
            rel = path.lstrip("/") or "index.html"
            target = (static / rel).resolve()
            root = static.resolve()
            if root not in target.parents and target != root or not target.is_file():
                target = root / "index.html"  # single-page app fallback
            if not target.is_file():
                self._json({"error": "not_found", "message": path}, 404)
                return
            data = target.read_bytes()
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix == ".wasm":
                ctype = "application/wasm"
            if target.suffix in (".js", ".mjs"):
                ctype = "text/javascript"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            # Cross-origin isolation enables multi-threaded WASM inference in the browser.
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.end_headers()
            self.wfile.write(data)

    return Handler


def _default(obj: Any) -> Any:
    import numpy as np

    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    raise TypeError(f"not JSON serializable: {type(obj).__name__}")


def _clean(value: Any) -> Any:
    """Replace non-finite floats with ``None`` so responses are strict JSON."""
    import math

    import numpy as np

    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_clean(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def serve(host: str, port: int, service: PhysixService, static: Path | None) -> ThreadingHTTPServer:
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit("the Physix API binds to loopback only")
    return ThreadingHTTPServer((host, port), make_handler(service, static))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Physix local HTTP API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--model", default=None, help="model bundle directory")
    p.add_argument("--static", type=Path, default=None, help="serve a built web app")
    p.add_argument("--no-labels", action="store_true")
    a = p.parse_args(argv)
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="[physix] %(message)s")
    service = PhysixService(a.model, label_store=None if a.no_labels else "data/generated/labels")
    httpd = serve(a.host, a.port, service, a.static)
    log.info("listening on http://%s:%d", a.host, a.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
