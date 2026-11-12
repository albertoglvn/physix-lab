"""HTTP API and MCP server wiring over the shared service."""

from __future__ import annotations

import asyncio
import json
import threading
import urllib.error
import urllib.request
from typing import Any

import pytest
from physix_mcp.http_api import _clean, serve
from physix_mcp.server import build_server
from physix_mcp.service import PhysixService

from physics.examples import plate_dict


@pytest.fixture(scope="module")
def service(tmp_path_factory) -> PhysixService:
    tmp = tmp_path_factory.mktemp("svc")
    return PhysixService(tmp / "no-bundle", label_store=None, fem_preset="fast")


@pytest.fixture(scope="module")
def base_url(service):
    httpd = serve("127.0.0.1", 0, service, None)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def call(url: str, body: Any = None, headers: dict[str, str] | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json", **(headers or {})}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read()), resp.headers
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read()), err.headers


def test_health_and_examples(base_url) -> None:
    status, body, _ = call(f"{base_url}/api/health")
    assert status == 200 and body["status"] == "ok"
    assert body["solver"]["name"] == "scikit-fem"
    status, ex, _ = call(f"{base_url}/api/examples")
    assert set(ex) == {"plate", "bracket"}
    status, model, _ = call(f"{base_url}/api/model")
    assert model["available"] is False


def test_predict_errors_and_cors(base_url) -> None:
    status, body, headers = call(
        f"{base_url}/api/predict",
        {"case": {"family": "plate"}},
        {"Origin": "http://localhost:5173"},
    )
    assert status == 422 and body["error"] == "invalid_case"
    assert headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    status, _, headers = call(f"{base_url}/api/health", headers={"Origin": "https://example.com"})
    assert headers.get("Access-Control-Allow-Origin") is None
    status, body, _ = call(f"{base_url}/api/unknown", {"x": 1})
    assert status == 404


def test_predict_round_trip(base_url) -> None:
    status, body, _ = call(f"{base_url}/api/predict", {"case": plate_dict(), "include_field": True})
    assert status == 200
    assert body["source"] == "fem_fallback" and body["fallback"]["reason"] == "model_unavailable"
    assert body["field"]["shape"] == [4, 64, 128]
    assert body["timing"]["http_ms"] >= body["timing"]["total_ms"] * 0.5


def test_non_finite_values_become_null() -> None:
    assert _clean({"a": float("inf"), "b": [1.0, float("nan")]}) == {"a": None, "b": [1.0, None]}


def test_loopback_only(service) -> None:
    with pytest.raises(SystemExit):
        serve("0.0.0.0", 0, service, None)


def test_mcp_tools_are_registered(service) -> None:
    server = build_server(service)
    tools = {t.name: t for t in asyncio.run(server.list_tools())}
    assert set(tools) == {"describe_domain", "predict_stress", "verify_with_solver", "optimize"}
    assert "case" in tools["predict_stress"].inputSchema["properties"]
    assert "variables" in tools["optimize"].inputSchema["required"]


def test_static_serving_is_isolated_and_falls_back(service, tmp_path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    (tmp_path / "app.wasm").write_bytes(b"\0asm")
    httpd = serve("127.0.0.1", 0, service, tmp_path)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        with urllib.request.urlopen(f"{base}/app.wasm", timeout=10) as resp:
            assert resp.headers["Content-Type"] == "application/wasm"
            assert resp.headers["Cross-Origin-Opener-Policy"] == "same-origin"
            assert resp.headers["Cross-Origin-Embedder-Policy"] == "require-corp"
        with urllib.request.urlopen(f"{base}/studio/deep/link", timeout=10) as resp:
            assert b"<title>x</title>" in resp.read()
        with urllib.request.urlopen(f"{base}/../../etc/passwd", timeout=10) as resp:
            assert b"<title>x</title>" in resp.read()
    finally:
        httpd.shutdown()
