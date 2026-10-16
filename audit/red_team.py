"""Local security probes. Use a fresh schema in a separate local test database.

Run from the repository root with backend/.venv/Scripts/python.exe audit/red_team.py.
The script never truncates application tables, contacts OpenRouter, or uses a real
Clerk session. Temporary RSA keys test the installed Clerk verifier itself.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "audit"
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import dotenv_values

env = dotenv_values(ROOT / "backend" / ".env")
test_url = os.environ.get("TEST_DATABASE_URL") or env.get("TEST_DATABASE_URL") or ""
live_url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL") or ""
t, live = urlparse(test_url), urlparse(live_url)
if t.hostname not in {"127.0.0.1", "localhost", "::1"} or not t.path:
    raise SystemExit("A separate local TEST_DATABASE_URL is required.")
if (t.hostname, t.port or 5432, t.path) == (live.hostname, live.port or 5432, live.path):
    raise SystemExit("Refusing to use the application database.")
os.environ["DATABASE_URL"] = test_url

import httpx
import jwt
import numpy as np
import soundfile as sf
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from clerk_backend_api.security.types import AuthenticateRequestOptions
from fastapi import HTTPException
from app import auth, coach, config, db, llm, main, stats, story, tts
from app.asr import recognizer
from app.audio import read_audio
from app.api import ROUTERS

results: list[dict] = []


def record(name, secure, evidence, scope="isolated API"):
    results.append({"name": name, "status": "PASS" if secure else "FINDING",
                    "scope": scope, "evidence": evidence})


def response(r):
    return {"status": r.status_code, "detail": r.text[:350] if "json" in r.headers.get("content-type", "") else ""}


schema = "security_audit_" + uuid.uuid4().hex
original_connect = db._connect
admin = original_connect()
admin.autocommit = True
cur = admin.cursor()
cur.execute("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")
if any(cur.fetchone()):
    admin.close()
    raise SystemExit("Tests need a role without superuser or BYPASSRLS rights.")
cur.execute("CREATE SCHEMA " + schema)


def isolated_connect():
    raw = original_connect()
    # No public fallback: a test can only find objects in its new schema.
    raw.cursor().execute("SELECT set_config('search_path', ?, false)", (schema,))
    raw.commit()
    return raw


def run():
    with patch.object(db, "_connect", isolated_connect):
        db.init()
        # Run existing regression tests in the same isolated schema.
        import pytest
        with (OUT / "existing-tests.txt").open("w", encoding="utf-8") as log:
            with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                with patch.object(llm, "_chat", side_effect=AssertionError("External LLM calls are blocked during the audit")):
                    code = pytest.main([str(ROOT / "backend" / "tests" / ("test_" + name + ".py"))
                                        for name in ["auth", "tracking", "coach", "story"]] + ["-q", "--tb=short"])
        record("Existing auth, tracking, coach and story regression suite", code == 0,
               {"exit_code": int(code), "log": "existing-tests.txt"}, "isolated PostgreSQL schema")

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private.public_key().public_bytes(serialization.Encoding.PEM,
                                                serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        opts = AuthenticateRequestOptions(jwt_key=pem)

        def token(uid="audit_a", **claims):
            now = int(time.time())
            payload = {"sub": uid, "sid": "sess_audit", "iss": "https://audit.clerk.accounts.dev",
                       "iat": now, "nbf": now - 10, "exp": now + 1800,
                       "azp": "https://bopomofo.app", **claims}
            return jwt.encode(payload, private, algorithm="RS256", headers={"kid": "audit"})

        A = {"Authorization": "Bearer " + token()}
        B = {"Authorization": "Bearer " + token("audit_b")}
        no_auth_matrix = []
        app_routes = [("/api" + r.path, r.methods) for router in ROUTERS for r in router.routes]
        with patch.object(auth, "_options", opts), patch.object(auth, "CLERK_SECRET_KEY", ""), \
             patch.object(auth, "CLERK_JWT_KEY", pem), patch.object(coach, "LIVE", False):
            client = TestClient(main.app, raise_server_exceptions=False)
            for route_path, methods in app_routes:
                if route_path in auth.PUBLIC:
                    continue
                path = route_path.replace("{sid}", "1").replace("{pid}", "1")
                for method in sorted(methods):
                    kwargs = {"json": {}} if method in {"PUT", "POST"} else {}
                    if path in {"/api/speech/analyze", "/api/symbols/check"}:
                        kwargs = {"files": {"audio": ("audit.wav", b"invalid", "audio/wav")},
                                  "data": {"text": "你好", "symbol": "ㄅ"}}
                    r = client.request(method, path, **kwargs)
                    no_auth_matrix.append({"method": method, "path": path, "status": r.status_code})
            record("Anonymous access rejected on every protected operation",
                   all(x["status"] == 401 for x in no_auth_matrix), no_auth_matrix)

            invalid = {"malformed": "not-a-jwt", "truncated": "a.b.c", "expired": token(exp=int(time.time()) - 120),
                       "future": token(nbf=int(time.time()) + 120),
                       "unsigned": jwt.encode({"sub": "audit_a", "exp": int(time.time()) + 120}, "", algorithm="none"),
                       "hmac": jwt.encode({"sub": "audit_a", "exp": int(time.time()) + 120}, "attacker", algorithm="HS256"),
                       "wrong_signature": jwt.encode({"sub": "audit_a", "exp": int(time.time()) + 120},
                            rsa.generate_private_key(public_exponent=65537, key_size=2048), algorithm="RS256")}
            for name, value in invalid.items():
                r = client.get("/api/profile", headers={"Authorization": "Bearer " + value})
                record("JWT " + name + " rejected", r.status_code == 401, response(r))
            r = client.get("/api/profile", headers={"Authorization": "Bearer " + token(azp="https://attacker.example")})
            record("JWT from an unapproved token origin rejected", r.status_code == 401, response(r))
            with patch.object(auth, "_options", AuthenticateRequestOptions(jwt_key=pem, authorized_parties=["https://bopomofo.app"])):
                r = client.get("/api/profile", headers={"Authorization": "Bearer " + token(azp="https://attacker.example")})
                record("Explicit token origin allowlist blocks wrong azp", r.status_code == 401, response(r))
            with patch.object(auth, "CLERK_JWT_KEY", ""):
                r = client.get("/api/profile", headers=A)
                record("Missing auth configuration fails closed", r.status_code == 503, response(r))

            # Use fresh users: existing tests have their own identities.
            client.put("/api/profile", json={"name": "Audit Alice", "user_id": "audit_b"}, headers=A)
            record("Profile field allowlist prevents mass assignment",
                   client.get("/api/profile", headers=A).json() == {"name": "Audit Alice"},
                   client.get("/api/profile", headers=A).json())
            record("Profile isolated between users", client.get("/api/profile", headers=B).json() == {},
                   client.get("/api/profile", headers=B).json())
            db.set_user("audit_a")
            s = db.add_sentence({"hanzi": "安全測試", "english": "audit only", "words": []}, "audit", "beginner")
            pid = coach.build("audit isolation", run_pipeline=lambda digest, reason, run: {
                "diagnosis": "audit only", "steps": [coach.cleaning.clean_step({"type": "read_symbols", "syms": ["ㄅ"], "target": 5}, set())],
                "milestones": None, "findings": []})
            sid = coach.store.steps(pid)[0]["id"]
            for path in [f"/api/sentences/{s['id']}", f"/api/coach/step/{sid}",
                         f"/api/coach/plan/{pid}/story"]:
                r = client.get(path, headers=B)
                record("Other user's object denied: " + path, r.status_code == 404, response(r))
            r = client.delete(f"/api/sentences/{s['id']}", headers=B)
            record("Other user cannot delete a sentence", client.get(f"/api/sentences/{s['id']}", headers=A).status_code == 200,
                   {"delete_status": r.status_code, "owner_read_status": client.get(f"/api/sentences/{s['id']}", headers=A).status_code})
            r = client.post(f"/api/coach/step/{sid}/skip", headers=B, json={"reason": "not_now"})
            db.set_user("audit_a")
            record("Other user cannot skip a step", coach.store.step(sid)["status"] == "open", response(r))
            r = client.post(f"/api/coach/plan/{pid}/story", headers=B)
            record("Other user cannot rewrite a plan story", r.status_code == 404, response(r))

            ev = {"area": "listening", "item": "audit", "ok": True,
                  "units": [{"kind": "tone", "expected": "3", "actual": "3", "ok": True}]}
            r = client.post("/api/progress/event", json=ev, headers=A)
            record("Valid event accepted", r.status_code == 200, response(r))
            exported = client.get("/api/stats/export.csv", headers=B)
            record("History export isolated between users", "audit" not in exported.text, {"status": exported.status_code})
            r = client.get("/api/stats", params={"area": "'; DROP TABLE events;--"}, headers=A)
            record("SQL injection in stats area stays a parameter", r.status_code == 200, response(r))
            r = client.put("/api/profile", json={"name": "'; DROP TABLE profile;--"}, headers=A)
            record("SQL injection in profile stays data", r.status_code == 200 and client.get("/api/profile", headers=A).json()["name"].startswith("';"), response(r))
            db.set_user(None)
            with db.conn() as c:
                n = c.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
            record("Pooled connection resets identity for anonymous users", n == 0, {"visible_rows": n})

            # Cache test only uses temporary files. Each user has a folder, data/tts/<user id>.
            with tempfile.TemporaryDirectory(prefix="bopomofo_audit_") as td, patch.object(tts, "DATA_DIR", Path(td)):
                cache = Path(td) / "tts" / "audit_a"
                cache.mkdir(parents=True)
                (cache / "alice-audio.wav").write_bytes(b"audit user A cache")
                r = client.post("/api/tts/cache/clear", headers=B)
                record("Ordinary user cannot clear another user's audio cache",
                       (cache / "alice-audio.wav").exists(), {**response(r), "cache_exists": (cache / "alice-audio.wav").exists()})
                clip = cache / "probe.wav"
                sf.write(str(clip), np.zeros(800, np.float32), 16000)
                calls = []

                def fake_speak(text, rate=0, voice="kokoro-f", user=None):
                    calls.append(text)
                    return clip

                with patch.object(tts, "speak", fake_speak):
                    statuses = [client.get("/api/tts", params={"text": "安全測試" + str(i)}).status_code for i in range(16)]
                    record("Public TTS has authentication or a request quota", 401 in statuses or 429 in statuses,
                           {"requests": len(statuses), "statuses": statuses, "synthesis_calls": len(calls),
                            "note": "Synthesis stubbed; this proves unrestricted admission, not load capacity."})
                    r = client.get("/api/tts", params={"text": "我住在私人地址"}, headers=A)
                    record("Personal audio is not marked for shared caching", "public" not in r.headers.get("cache-control", ""),
                           {"status": r.status_code, "cache_control": r.headers.get("cache-control")})
                    r = client.get("/api/tts", params={"text": "x" * 401}, headers=A)
                    record("TTS rejects text above 400 characters", r.status_code == 400, response(r))
                    r = client.get("/api/tts", params={"text": "安全", "voice": "../../.env"}, headers=A)
                    record("Voice input cannot select a file path", r.status_code == 200,
                           {"status": r.status_code, "note": "Route passes voice to the TTS function; BY_ID uses an allowlist and falls back."})

            # An exception marker contains only synthetic data.
            with patch.object(db, "get_profile", side_effect=RuntimeError("AUDIT_INTERNAL_PRIVATE_MARKER")):
                r = client.get("/api/profile", headers=A)
                record("Internal exception detail not disclosed", "AUDIT_INTERNAL_PRIVATE_MARKER" not in r.text, response(r))
            with patch.object(recognizer, "error", "AUDIT_PRIVATE_MODEL_PATH"):
                r = client.get("/api/health")
                record("Public health response hides internal model errors", "AUDIT_PRIVATE_MODEL_PATH" not in r.text, response(r))
            for path in ["/docs", "/redoc", "/openapi.json"]:
                r = client.get(path)
                record("API discovery route protected: " + path, r.status_code in {401, 403, 404}, {"status": r.status_code})
            for origin in ["https://attacker.example", "https://unused.bopomofo.app", "http://192.168.1.42:9999"]:
                r = client.options("/api/profile", headers={"Origin": origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type"})
                record("CORS restricts origin " + origin, r.status_code == 400,
                       {"status": r.status_code, "allow_origin": r.headers.get("access-control-allow-origin")})
            r = client.get("/api/tts/voices", headers={"Host": "attacker.example"})
            record("Unknown Host rejected", r.status_code in {400, 403, 421}, {"status": r.status_code})
            r = client.put("/api/profile", headers={"Cookie": "__session=" + A["Authorization"][7:]}, json={"name": "CSRF"})
            record("Cookie-only CSRF cannot mutate a profile", r.status_code == 401, response(r))

            csv_payload = '=HYPERLINK("https://attacker.example","audit")'
            r = client.post("/api/progress/event", json={**ev, "item": csv_payload}, headers=A)
            export = client.get("/api/stats/export.csv", headers=A)
            cells = list(csv.DictReader(io.StringIO(export.text)))
            record("CSV formula input is neutralized", all(row["item"] != csv_payload for row in cells),
                   {"event_status": r.status_code, "raw_formula_exported": any(row["item"] == csv_payload for row in cells)})
            r = client.post("/api/progress/event", json={**ev, "area": "evil", "score": -999, "tries": -10, "details": {"padding": "x" * 1_100_000}}, headers=A)
            record("Oversized nested event and invalid metric rejected", r.status_code in {413, 422},
                   {"status": r.status_code, "details_bytes": 1_100_000, "score": -999, "tries": -10, "area": "evil"})
            r = client.put("/api/progress/day", json={"day": "9999-99-99", "seconds": 1, "goal_min": -100}, headers=A)
            record("Invalid date and daily goal rejected", r.status_code in {400, 422}, response(r))
            r = client.get("/api/stats", params={"days": 1_000_000_000}, headers=A)
            record("Out-of-range stats window rejected", r.status_code in {400, 422}, response(r))

            # Decoding and resampling are real, but input size remains small.
            wav = io.BytesIO()
            sf.write(wav, np.zeros(31 * 1000, np.float32), 1000, format="WAV")
            interp_calls = []
            real_interp = np.interp

            def interp(*args, **kwargs):
                interp_calls.append(len(args[0]))
                return real_interp(*args, **kwargs)

            with patch.object(np, "interp", interp):
                try:
                    read_audio(wav.getvalue())
                except HTTPException as e:
                    record("Audio duration checked before resampling allocation", not interp_calls,
                           {"status": e.status_code, "resampled_before_reject": bool(interp_calls), "allocated_samples": interp_calls})
            for path, data in [("/api/speech/analyze", {"text": "x" * 100_000}),
                               ("/api/symbols/check", {"symbol": "x" * 100_000})]:
                r = client.post(path, headers=A, data=data, files={"audio": ("a.wav", wav.getvalue(), "audio/wav")})
                record("Upload text bound enforced before model readiness: " + path, r.status_code == 422,
                       {"status": r.status_code, "field_length": 100_000})

            # A file is parsed before FastAPI runs route-level auth dependencies.
            from starlette.formparsers import MultiPartParser
            parsed = []
            real_parse = MultiPartParser.parse

            async def parse(parser):
                form = await real_parse(parser)
                uploaded = form.get("audio")
                parsed.append(getattr(uploaded, "size", None))
                return form

            with patch.object(MultiPartParser, "parse", parse):
                r = client.post("/api/symbols/check", data={"symbol": "ㄅ"},
                                files={"audio": ("a.wav", b"x" * 3_000_000, "audio/wav")})
            record("Unauthorized file rejected before upload parsing", r.status_code == 401 and not parsed,
                   {"status": r.status_code, "parsed_file_sizes": parsed})
            samples = io.BytesIO()
            sf.write(samples, np.sin(np.arange(8000) / 20).astype(np.float32) * .1, 16000, format="WAV")
            inference = []

            def log_probs(a):
                inference.append(len(a))
                return np.zeros((2, 2), np.float32)

            with patch.object(recognizer, "session", object()), patch.object(recognizer, "log_probs", log_probs):
                r = client.post("/api/symbols/check", headers=A, data={"symbol": "invalid-symbol"},
                                files={"audio": ("a.wav", samples.getvalue(), "audio/wav")})
            record("Invalid symbol rejected before speech inference", r.status_code in {400, 422} and not inference,
                   {"status": r.status_code, "inference_calls": len(inference), "inference_stubbed": True})
            nan_wav = io.BytesIO()
            sf.write(nan_wav, np.full(8000, np.nan, np.float32), 16000, format="WAV", subtype="FLOAT")
            try:
                decoded = read_audio(nan_wav.getvalue())
                record("Non-finite audio samples rejected", bool(np.isfinite(decoded).all()),
                       {"accepted_nan_samples": int(np.isnan(decoded).sum())})
            except HTTPException as e:
                record("Non-finite audio samples rejected", e.status_code == 400, {"status": e.status_code})

            # Database TLS selection can be inspected without a remote connection.
            ssl_options = []

            def no_connection(**kwargs):
                ctx = kwargs.get("ssl_context")
                ssl_options.append({"verify_mode": int(ctx.verify_mode) if ctx else None,
                                    "check_hostname": bool(ctx.check_hostname) if ctx else None})
                return SimpleNamespace(register_in_adapter=lambda *args: None)

            with patch.object(config, "DATABASE_URL", "postgresql://audit:fake@db.example/audit?sslmode=require"), \
                 patch.object(db.pg8000.dbapi, "connect", no_connection):
                original_connect()
            record("Remote database TLS verifies the server with documented sslmode=require", ssl_options[0]["check_hostname"],
                   ssl_options[0], "real connection configuration, network stubbed")

            # POOL_SIZE bounds retained idle connections, not in-flight connections.
            from threading import Barrier, Lock
            pool_gate, pool_guard = Barrier(12), Lock()
            active = {"n": 0, "peak": 0}

            def hold_connection(_):
                db.set_user("audit_a")
                with db.conn():
                    with pool_guard:
                        active["n"] += 1
                        active["peak"] = max(active["peak"], active["n"])
                    pool_gate.wait(timeout=10)
                    with pool_guard:
                        active["n"] -= 1

            with ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(hold_connection, range(12)))
            record("Database pool caps active connection count", active["peak"] <= db.POOL_SIZE,
                   {"declared_pool_size": db.POOL_SIZE, "observed_active_connections": active["peak"]}, "real local PostgreSQL connections")

            # Cache writers use the same temporary filename. Make their overlap deterministic.
            with tempfile.TemporaryDirectory(prefix="bopomofo_audit_race_") as td:
                (Path(td) / "tts").mkdir()
                writer_gate = Barrier(2)
                real_write = sf.write

                def write(*args, **kwargs):
                    writer_gate.wait(timeout=5)
                    real_write(*args, **kwargs)
                    writer_gate.wait(timeout=5)

                engine = SimpleNamespace(generate=lambda *args, **kwargs: tts._Audio(np.ones(160, np.float32) * .1, 16000))
                with patch.object(tts, "DATA_DIR", Path(td)), patch.dict(tts._engines, {"breeze2": engine}), \
                     patch.object(tts.sf, "write", write), patch.object(tts, "level", lambda a, sr: a):
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        jobs = [pool.submit(tts.speak, "並行安全測試", 0, "breeze2", "audit_race") for _ in range(2)]
                        outcomes = []
                        for job in jobs:
                            try:
                                job.result(timeout=10)
                                outcomes.append("ok")
                            except Exception as e:
                                outcomes.append(type(e).__name__)
                record("Concurrent identical TTS cache writes succeed", outcomes == ["ok", "ok"],
                       {"outcomes": outcomes, "engine_stubbed": True, "filesystem_real": True})

            # A provider stub tests admission and output validation, without billing.
            billable = []

            async def fake_translate(text):
                billable.append(text)
                return {"english": "audit", "words": []}

            with patch.object(llm, "translate", fake_translate):
                statuses = [client.post("/api/text/translate", headers=A, json={"text": "測試"}).status_code for _ in range(16)]
                record("Paid translation has a per-user request quota", 429 in statuses,
                       {"requests": 16, "statuses": statuses, "provider_calls": len(billable), "provider_stubbed": True})
            r = client.post("/api/text/analyze", headers=A, json={"text": "x" * 401})
            record("Text analysis length limited", r.status_code == 422, {"status": r.status_code})
            record("LLM sentence output length limited", llm._clean({"hanzi": "我" * 10_000, "english": "audit", "words": []}) is None,
                   {"accepted_hanzi_length": len(llm._clean({"hanzi": "我" * 10_000, "english": "audit", "words": []})["hanzi"])}, "real output validator")
            record("LLM story rejects unknown component types", story.clean_card({"blocks": [{"type": "script", "props": {"text": "attack"}}]}, {})[0] is None,
                   {"unknown_component_rejected": True}, "real output validator")
            with patch.object(httpx, "AsyncClient") as ac:
                from unittest.mock import AsyncMock, MagicMock
                request_body = {}
                fake_response = MagicMock(status_code=200)
                fake_response.json.return_value = {"choices": [{"message": {"content": '{}'}}]}

                async def post(url, **kwargs):
                    request_body.update(kwargs["json"])
                    return fake_response

                ac.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
                ac.return_value.__aexit__ = AsyncMock(return_value=False)
                import asyncio
                with patch.object(llm, "OPENROUTER_API_KEY", "AUDIT_FAKE_KEY"):
                    asyncio.run(llm._chat([{"role": "user", "content": "audit"}]))
                record("LLM output has a hard token budget", bool(request_body.get("max_tokens")),
                       {"max_tokens": request_body.get("max_tokens"), "provider_stubbed": True})

            def parallel_profile(i):
                uid = "audit_parallel_" + str(i)
                headers = {"Authorization": "Bearer " + token(uid)}
                name = "Parallel " + str(i)
                client.put("/api/profile", headers=headers, json={"name": name})
                return client.get("/api/profile", headers=headers).json() == {"name": name}

            with ThreadPoolExecutor(max_workers=5) as pool:
                checks = list(pool.map(parallel_profile, range(10)))
            record("Concurrent requests retain user isolation", all(checks), {"users": 10, "isolated": sum(checks)})

        # Current running services: read-only probes, except one normal public audio request.
        with httpx.Client(timeout=20, follow_redirects=False, trust_env=False) as local:
            live_probes = []
            for port, paths in [(8765, ["/api/health", "/api/profile", "/docs", "/openapi.json"]),
                                (3210, ["/", "/profile", "/stats", "/sign-in", "/.env", "/_next/../.env"])]:
                for path in paths:
                    try:
                        r = local.get(f"http://127.0.0.1:{port}{path}")
                        live_probes.append({"port": port, "path": path, "status": r.status_code,
                            "headers": {k: r.headers.get(k) for k in ["content-security-policy", "x-frame-options",
                                "x-content-type-options", "referrer-policy", "permissions-policy", "cache-control"]}})
                    except httpx.HTTPError as e:
                        live_probes.append({"port": port, "path": path, "error": type(e).__name__})
            record("Live service header inventory", all("error" not in p for p in live_probes), live_probes, "running local HTTP services")
            for path in ["/profile", "/stats", "/coach", "/sentences", "/onboarding"]:
                r = local.get("http://127.0.0.1:3210" + path, headers={"x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware"})
                record("Next proxy bypass header blocked: " + path, r.status_code in {301, 302, 303, 307, 308, 401, 403, 404},
                       {"status": r.status_code}, "running local Next server")
            r = local.get("http://127.0.0.1:8765/api/tts", params={"text": "安全測試", "voice": "breeze2"})
            record("Real public TTS requires authentication", r.status_code in {401, 403, 429},
                   {"status": r.status_code, "bytes": len(r.content), "content_type": r.headers.get("content-type"),
                    "cache_control": r.headers.get("cache-control")}, "running local API, real TTS inference")


try:
    with (OUT / "probe-stderr.txt").open("w", encoding="utf-8") as stderr:
        with contextlib.redirect_stderr(stderr):
            run()
finally:
    db.close_pool()
    cur.execute("DROP SCHEMA " + schema + " CASCADE")
    admin.close()
    report = {"commit": os.popen("git rev-parse HEAD").read().strip(),
              "test_database": t.path.lstrip("/"), "temporary_schema_removed": True,
              "summary": {s: sum(r["status"] == s for r in results) for s in ["PASS", "FINDING"]}, "probes": results}
    (OUT / "red-team-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"]))
    for r in results:
        if r["status"] == "FINDING":
            print(r["status"] + " " + r["name"])
