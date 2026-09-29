#!/usr/bin/env python3
"""Local mock tests for tips-admin v2 (no network, no real credentials).

Covers the 5 natural-language change patterns end-to-end (synthetic),
plus malformed / unknown / permission / missing-expectation / hash-mismatch,
real-server failed/unknown receipt shapes, arbitrary states, HTTP-200
malformed bodies, transport failures, explicit-key recovery, canonical-origin
partitioning, and journal corruption.
"""
import io
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import importlib.machinery
import importlib.util

# __file__-relative so the suite reproduces from any checkout location.
BIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "bin")
sys.path.insert(0, BIN)
_loader = importlib.machinery.SourceFileLoader(
    "tips_admin", os.path.join(BIN, "tips-admin"))
spec = importlib.util.spec_from_loader("tips_admin", _loader)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# No real credential plumbing in tests.
mod.add_surrogate_to_request = lambda req, credential, allowed_hosts=None: None

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("ok   " if cond else "FAIL ") + name +
          (f" -- {detail}" if (detail and not cond) else ""))


CLASS_ID = "11111111-2222-3333-4444-555555555555"
HASH_BEFORE = "b" * 64
HASH_AFTER = "a" * 64
FULL_SCOPES = ["class-details:read", "class-info:write",
               "weekly-plan:write", "lesson-plan:write"]


def health_payload(scopes=None):
    return {"data": {"apiVersion": "2", "credentialId": "cred-1",
                     "scopes": FULL_SCOPES if scopes is None else scopes}}


def workspace_payload():
    return {"data": {"id": CLASS_ID, "version": "v1",
                     "basic": {"name": "고1 수학A반"},
                     "weeklySlots": [], "lessons": [],
                     "window": {"from": "2030-10-01", "to": "2030-10-31"},
                     "timezone": "Asia/Seoul", "capabilities": {},
                     "verificationHash": HASH_BEFORE}}


def preview_payload(token="pv-1"):
    return {"data": {"previewToken": token,
                     "expiresAt": "2030-10-01T00:10:00+09:00",
                     "before": {"id": CLASS_ID,
                                "verificationHash": HASH_BEFORE},
                     "after": {"id": CLASS_ID,
                               "verificationHash": HASH_AFTER},
                     "notifications": {"state": "not_requested"}}}


def applied_payload(request_key, vhash=HASH_AFTER):
    return {"data": {"operationId": request_key, "state": "applied",
                     "class": {"id": CLASS_ID,
                               "verificationHash": vhash}}}


class FakeResp:
    def __init__(self, payload):
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeRespRaw:
    """HTTP 200 with a non-JSON body (HTML, truncated, non-UTF8)."""

    def __init__(self, raw: bytes):
        self._raw = raw

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    def __init__(self, handler):
        self.handler = handler

    def open(self, req, timeout=None):
        return self.handler(req)


def http_error(url, code, payload):
    return urllib.error.HTTPError(
        url, code, "error", {},
        io.BytesIO(json.dumps(payload).encode("utf-8")))


def http_error_raw(url, code, raw: bytes):
    """Non-JSON error body (HTML, truncated, malformed)."""
    return urllib.error.HTTPError(url, code, "error", {}, io.BytesIO(raw))


class Server:
    """Routes by (method, path). Records every call."""

    def __init__(self):
        self.calls = []
        self.health_scopes = None
        self.preview_seen_body = None
        self.commit_seen_key = None
        self.fail_preview_with = None
        self.fail_commit_with = None
        self.fail_get_with = None
        self.commit_state = "applied"
        self.commit_hash = HASH_AFTER
        self.commit_raw = None      # raw bytes for a 200 with malformed body
        self.get_state = None       # override state for GET /operations/{key}
        self.raise_in_handler = None  # exception to simulate transport failure

    def _state_envelope(self, key, state):
        """Real server receipt shapes: failed has no class; unknown has no
        class either."""
        if state == "failed":
            return {"data": {"operationId": key, "state": "failed",
                             "error": {"code": "timetable_resource_conflict",
                                       "sqlstate": "23P01"}}}
        if state == "unknown":
            return {"data": {"operationId": key, "state": "unknown",
                             "retryWithNewKey": False}}
        return {"data": {"operationId": key, "state": state}}

    def handler(self, req):
        url = req.full_url
        parsed = urllib.parse.urlparse(url)
        path = parsed.path
        method = req.get_method()
        body = req.data.decode("utf-8") if req.data else None
        hdrs = {k.lower(): v for k, v in req.header_items()}
        self.calls.append((method, path, body, hdrs))
        if path == "/api/v2/health":
            return FakeResp(health_payload(self.health_scopes))
        if path == "/api/v1/health":
            return FakeResp({"data": {"apiVersion": "1",
                                      "credentialId": "cred-1",
                                      "scopes": []}})
        if method == "GET" and path.endswith("/catalogs"):
            return FakeResp({"data": {"kind": "teachers", "page": 1,
                                      "pageSize": 20, "total": 1,
                                      "items": [{"id": "t-9", "name": "김선생",
                                                 "subjects": ["math"]}]}})
        if method == "POST" and path.endswith("/changes/preview"):
            if self.fail_preview_with is not None:
                raise self.fail_preview_with
            self.preview_seen_body = json.loads(body)
            return FakeResp(preview_payload())
        if method == "GET" and path.startswith("/api/v2/classes/"):
            return FakeResp(workspace_payload())
        if method == "POST" and path == "/api/v2/operations":
            if self.fail_commit_with is not None:
                raise self.fail_commit_with
            if self.raise_in_handler is not None:
                raise self.raise_in_handler
            key = hdrs.get("idempotency-key")
            self.commit_seen_key = key
            if self.commit_raw is not None:
                return FakeRespRaw(self.commit_raw)
            if self.commit_state == "applied":
                return FakeResp(applied_payload(key, self.commit_hash))
            return FakeResp(self._state_envelope(key, self.commit_state))
        if method == "GET" and path == "/api/v2/operations":
            return FakeResp({"data": {"page": 1, "pageSize": 20, "total": 0,
                                      "items": []}})
        if method == "GET" and path.startswith("/api/v2/operations/"):
            if self.fail_get_with is not None:
                raise self.fail_get_with
            key = path.rsplit("/", 1)[-1]
            if self.get_state is not None:
                return FakeResp(self._state_envelope(key, self.get_state))
            return FakeResp(applied_payload(key, self.commit_hash))
        if method == "POST" and path == "/api/v1/operations":
            key = hdrs.get("idempotency-key")
            slots = [{"weekday": 2, "startMinute": 1140, "endMinute": 1260,
                      "teacherId": "t-1", "classroomId": "r-1"}]
            return FakeResp({"data": {"operationId": key, "state": "applied",
                                      "class": {"id": CLASS_ID,
                                                "weeklySlots": slots}}})
        if method == "POST" and path.endswith("/weekly-time/preview"):
            return FakeResp({"data": {"previewToken": "pv-v1",
                                      "expiresAt": "2030-10-01T00:10:00+09:00",
                                      "before": {"id": CLASS_ID},
                                      "after": {"weeklySlots": [
                                          {"id": "ws-9", "weekday": 2,
                                           "startMinute": 1140,
                                           "endMinute": 1260,
                                           "teacherId": "t-1",
                                           "classroomId": "r-1"}]}}})
        raise AssertionError(f"no route for {method} {path}")


def use_server(srv):
    mod.urllib.request.build_opener = lambda *a, **k: FakeOpener(srv.handler)


def run_main(argv):
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = io.StringIO(), io.StringIO()
    code = 0
    try:
        mod.main(argv)
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else 0
    finally:
        out, err = sys.stdout.getvalue(), sys.stderr.getvalue()
        sys.stdout, sys.stderr = old_out, old_err
    return code, out, err


def journal_path(td, version):
    return mod.resolve_journal_file(
        td, version,
        mod.canonical_origin_dir("https://api.example.test/api/v2"), "cred-1")


def base_v2(td):
    return ["--base-url", "https://api.example.test/api/v2",
            "--allowed-hosts", "api.example.test", "--journal", td]


def base_v1(td):
    return ["--base-url", "https://api.example.test/api/v1",
            "--allowed-hosts", "api.example.test", "--journal", td]


KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

# ---------------------------------------------------------------- patterns

def full_flow(td, srv, preview_args, token="pv-1", key=KEY):
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["workspace", "get", "--class-id", CLASS_ID,
                       "--from", "2030-10-01", "--to", "2030-10-31"])
    assert code == 0, (code, err)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "test"] + preview_args)
    assert code == 0, (code, err)
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", token,
                       "--idempotency-key", key])
    return code, out, err


# Pattern 1: 휴강 + 연결 보강
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    lessons = [
        {"date": "2030-10-13", "state": "cancelled",
         "makeup": {"date": "2030-10-09", "startMinute": 1160,
                    "endMinute": 1280, "teacherId": "t-1",
                    "classroomId": "r-1"}},
        {"date": "2030-10-18", "state": "cancelled"},
    ]
    code, out, err = full_flow(td, srv, ["--lessons-json", json.dumps(lessons)])
    body = srv.preview_seen_body
    check("P1 cancel+makeup -> exit 0",
          code == 0 and body["lessons"][0]["makeup"]["date"] == "2030-10-09",
          f"code={code} err={err[-200:]}")

# Pattern 2: 수업계획 재구성 (휴보강 표시 없이)
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    lessons = [
        {"date": "2030-10-04", "state": "scheduled"},
        {"date": "2030-10-06", "state": "scheduled"},
        {"date": "2030-10-11", "state": "skipped"},
        {"date": "2030-10-13", "state": "scheduled",
         "timing": {"startMinute": 1160, "endMinute": 1280,
                    "teacherId": "t-1", "classroomId": "r-1"}},
    ]
    code, out, err = full_flow(td, srv, ["--lessons-json", json.dumps(lessons)])
    check("P2 plan rebuild -> exit 0", code == 0, f"code={code}")

# Pattern 3: 단일 회차 이동
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    lessons = [{"lessonId": "les-1", "date": "2030-10-09",
                "state": "scheduled",
                "timing": {"startMinute": 1160, "endMinute": 1280,
                           "teacherId": "t-1", "classroomId": "r-1"}}]
    code, out, err = full_flow(td, srv, ["--lessons-json", json.dumps(lessons)])
    check("P3 single session move -> exit 0", code == 0, f"code={code}")

# Pattern 4: 주간 슬롯 시간 변경
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    slots = [{"id": "ws-1", "weekday": 2, "startMinute": 1140,
              "endMinute": 1260, "teacherId": "t-1", "classroomId": "r-1",
              "sortOrder": 0}]
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "slot time",
                       "--weekly-slots-json", json.dumps(slots)])
    note_ok = code == 0 and "IMMEDIATELY" in err
    code2, out2, err2 = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    body = srv.preview_seen_body
    check("P4 weekly slot time -> exit 0 + immediate-template note",
          note_ok and code2 == 0 and body["weeklySlots"][0]["id"] == "ws-1",
          f"{code}/{code2}")

# Pattern 5: 선생님 교체 (catalogs -> exact ID -> changes preview)
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["catalogs", "get", "--class-id", CLASS_ID,
                       "--kind", "teachers", "--search", "김"])
    items = json.loads(out)["data"]["items"]
    tid = items[0]["id"] if items and items[0]["name"] == "김선생" else None
    slots = [{"id": "ws-1", "weekday": 2, "startMinute": 1140,
              "endMinute": 1260, "teacherId": tid, "classroomId": "r-1",
              "sortOrder": 0}]
    code2, out2, err2 = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "teacher change",
                       "--weekly-slots-json", json.dumps(slots)])
    code3, out3, err3 = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("P5 catalogs->exact ID->commit -> exit 0",
          code == 0 and code2 == 0 and code3 == 0 and tid == "t-9",
          f"{code}/{code2}/{code3}")

# ---------------------------------------------------------------- errors

# malformed preview response (no previewToken) -> exit 4, nothing recorded
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    def bad_preview(req, parsed):
        return FakeResp({"data": {"before": {"id": CLASS_ID},
                                  "after": {"verificationHash": HASH_AFTER}}})
    orig = srv.handler
    def handler(req):
        parsed = urllib.parse.urlparse(req.full_url)
        if parsed.path.endswith("/changes/preview"):
            srv.calls.append(("POST", parsed.path, None, {}))
            return bad_preview(req, parsed)
        return orig(req)
    use_server(srv)
    mod.urllib.request.build_opener = lambda *a, **k: FakeOpener(handler)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    check("malformed preview -> exit 4", code == 4, f"code={code}")

# unknown state -> exit 4, single POST
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    srv.commit_state = "unknown"
    code, out, err = full_flow(
        td, srv, ["--lessons-json",
                  json.dumps([{"date": "2030-10-05", "state": "cancelled"}])])
    posts = [c for c in srv.calls if c[0] == "POST" and c[1] == "/api/v2/operations"]
    check("unknown -> exit 4, no new key",
          code == 4 and len(posts) == 1 and "unknown" in err.lower(),
          f"code={code} posts={len(posts)}")

# 403 on changes preview -> exit 3, no bypass
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    srv.fail_preview_with = http_error(
        "https://api.example.test/api/v2/x", 403,
        {"error": {"code": "forbidden", "message": "denied"}})
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    check("403 preview -> exit 3, no bypass",
          code == 3 and "bypass" in err.lower(), f"code={code}")

# missing scope -> exit 2 BEFORE any change request is sent
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    srv.health_scopes = ["class-details:read"]  # no lesson-plan:write
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    preview_calls = [c for c in srv.calls if c[1].endswith("/changes/preview")]
    check("missing scope -> exit 2, no preview POST",
          code == 2 and not preview_calls and "lesson-plan:write" in err,
          f"code={code}")

# commit without preview expectation -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-nope",
                       "--idempotency-key", KEY])
    check("commit w/o expectation -> exit 4", code == 4, f"code={code}")

# hash mismatch -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    srv.commit_hash = "z" * 64
    code, out, err = full_flow(
        td, srv, ["--lessons-json",
                  json.dumps([{"date": "2030-10-05", "state": "cancelled"}])])
    check("hash mismatch -> exit 4",
          code == 4 and "verificationHash" in err, f"code={code}")

# applied receipt inside HTTP error, hash matches -> exit 0 (v2 checks hash)
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    assert code == 0, (code, err)
    srv.fail_commit_with = http_error(
        "https://api.example.test/api/v2/operations", 409,
        {"data": applied_payload(KEY)["data"],
         "error": {"code": "conflict", "message": "dup"}})
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("409+applied, hash ok -> exit 0", code == 0, f"code={code} {err[-150:]}")

# applied receipt inside HTTP error, hash WRONG -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    assert code == 0, (code, err)
    srv.fail_commit_with = http_error(
        "https://api.example.test/api/v2/operations", 409,
        {"data": applied_payload(KEY, "z" * 64)["data"],
         "error": {"code": "conflict", "message": "dup"}})
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("409+applied, hash wrong -> exit 4",
          code == 4 and "verificationHash" in err, f"code={code}")

# approval workflow required -> exit 3, no bypass
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    srv.fail_preview_with = http_error(
        "https://api.example.test/api/v2/x", 409,
        {"error": {"code": "agent_approval_workflow_required",
                   "message": "overlaps approved item"}})
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    check("agent_approval_workflow_required -> exit 3",
          code == 3 and "approval workflow" in err.lower(), f"code={code}")

# ---------------------------------------------------------------- validation

with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["workspace", "get", "--class-id", CLASS_ID,
                       "--from", "2030-01-01", "--to", "2030-05-02"])
    check("window >93d -> exit 2, no request",
          code == 2 and not srv.calls, f"code={code}")

    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x", "--lessons-json",
                       json.dumps([{"date": "2030-10-05", "state": "cancelled"}]
                                  * 51)])
    check("lessons >50 -> exit 2", code == 2, f"code={code}")

    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x", "--lessons-json",
                       json.dumps([{"date": "2030-10-05", "state": "scheduled",
                                    "makeup": {"date": "2030-10-09",
                                               "startMinute": 1160,
                                               "endMinute": 1280,
                                               "teacherId": "t-1",
                                               "classroomId": "r-1"}}])])
    check("makeup on non-cancelled -> exit 2",
          code == 2 and "cancelled" in err, f"code={code}")

    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x", "--lessons-json",
                       json.dumps([{"date": "2020-01-01",
                                    "state": "cancelled"}])])
    check("past lesson date -> exit 2", code == 2, f"code={code}")

    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x", "--weekly-slots-json",
                       json.dumps([{"id": "ws-1", "weekday": 2,
                                    "startMinute": 1140, "endMinute": 1260,
                                    "teacherId": "t-1",
                                    "classroomId": "r-1"}])])
    check("weeklySlots missing sortOrder -> exit 2", code == 2, f"code={code}")

    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x"])
    check("empty change -> exit 2", code == 2, f"code={code}")

# operations list
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(base_v2(td) + ["operations", "list", "--page", "1"])
    check("operations list -> exit 0",
          code == 0 and json.loads(out)["data"]["page"] == 1, f"code={code}")

# version gates
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["classes", "get", "--id", CLASS_ID])
    check("v1 cmd on v2 base -> exit 2", code == 2, f"code={code}")
    code, out, err = run_main(
        base_v1(td) + ["workspace", "get", "--class-id", CLASS_ID,
                       "--from", "2030-10-01", "--to", "2030-10-31"])
    check("v2 cmd on v1 base -> exit 2", code == 2, f"code={code}")

# operations get: key committed on v2, queried on v1 base -> exit 2
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    code, out, err = full_flow(
        td, srv, ["--lessons-json",
                  json.dumps([{"date": "2030-10-05", "state": "cancelled"}])])
    assert code == 0, (code, err)
    code, out, err = run_main(
        base_v1(td) + ["operations", "get", "--request-key", KEY])
    check("get v2 key on v1 base -> exit 2", code == 2, f"code={code}")

# v1 regression: weekly-time preview + commit still works (v1 journal partition)
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    use_server(srv)
    code, out, err = run_main(
        base_v1(td) + ["classes", "weekly-time", "preview", "--id", CLASS_ID,
                       "--slot-id", "ws-1", "--start-minute", "1140",
                       "--end-minute", "1260", "--expected-version", "f" * 64,
                       "--reason", "v1 regression"])
    code2, out2, err2 = run_main(
        base_v1(td) + ["operations", "commit", "--preview-token", "pv-v1",
                       "--idempotency-key", KEY])
    jp = journal_path(td, "1")
    check("v1 weekly-time flow still exit 0",
          code == 0 and code2 == 0 and os.path.exists(jp),
          f"{code}/{code2}")

# ---------------------------------------------------------------- 5xx without
# durable receipt -> UNCONFIRMED (exit 4), same key preserved, exactly one
# commit POST. The DB commit may have succeeded while the response/proxy
# failed: never a confirmed failure, never a new key/preview/browser retry.

def _preview_ok_v2(td, srv):
    use_server(srv)
    code, out, err = run_main(
        base_v2(td) + ["changes", "preview", "--class-id", CLASS_ID,
                       "--expected-version", "f" * 64,
                       "--from", "2030-10-01", "--to", "2030-10-31",
                       "--reason", "x",
                       "--lessons-json",
                       json.dumps([{"date": "2030-10-05",
                                    "state": "cancelled"}])])
    assert code == 0, (code, err)


def _commit_posts(srv):
    return [c for c in srv.calls
            if c[0] == "POST" and c[1] == "/api/v2/operations"]


# commit 500 + no receipt -> exit 4 UNCONFIRMED, single POST
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.fail_commit_with = http_error(
        "https://api.example.test/api/v2/operations", 500, {})
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 commit 500 no receipt -> exit 4 UNCONFIRMED, single POST",
          code == 4 and len(_commit_posts(srv)) == 1
          and "UNCONFIRMED" in err and KEY in err,
          f"code={code} posts={len(_commit_posts(srv))}")

# same-key GET after unconfirmed commit -> applied + hash match -> exit 0;
# GET receipt 5xx -> still UNCONFIRMED
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.fail_commit_with = http_error(
        "https://api.example.test/api/v2/operations", 500, {})
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    assert code == 4, (code, err)
    code2, out2, err2 = run_main(
        base_v2(td) + ["operations", "get", "--request-key", KEY])
    still_one = len(_commit_posts(srv)) == 1
    srv.fail_get_with = http_error(
        "https://api.example.test/api/v2/operations/" + KEY, 503, {})
    code3, out3, err3 = run_main(
        base_v2(td) + ["operations", "get", "--request-key", KEY])
    check("v2 same-key GET applied+hash -> exit 0; GET 5xx -> exit 4",
          code2 == 0 and still_one and code3 == 4 and "UNCONFIRMED" in err3,
          f"get={code2} get5xx={code3}")

# commit 503 with HTML body -> exit 4, same key preserved in journal
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.fail_commit_with = http_error_raw(
        "https://api.example.test/api/v2/operations", 503,
        b"<html><body>Bad Gateway</body></html>")
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    jp = journal_path(td, "2")
    rec = None
    for line in open(jp):
        r = json.loads(line)
        if r.get("requestKey") == KEY and r.get("kind", "commit") == "commit":
            rec = r
    check("v2 commit 503 HTML -> exit 4, same key preserved",
          code == 4 and "UNCONFIRMED" in err and rec is not None
          and rec.get("previewToken") == "pv-1",
          f"code={code}")

# commit 502 with malformed JSON -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.fail_commit_with = http_error_raw(
        "https://api.example.test/api/v2/operations", 502, b"{not json")
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 commit 502 malformed JSON -> exit 4",
          code == 4 and "UNCONFIRMED" in err, f"code={code}")

# ---------------------------------------------------------------- new receipt /
# transport / journal regression coverage

# commit 200 with the REAL failed receipt shape (no class) -> exit 3,
# request key + error.code verified
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.commit_state = "failed"
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 commit 200 failed receipt (no class) -> exit 3",
          code == 3 and "timetable_resource_conflict" in err
          and "23P01" in err and KEY in out,
          f"code={code}")

# commit 200 with the REAL unknown receipt shape -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.commit_state = "unknown"
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 commit 200 unknown receipt -> exit 4",
          code == 4 and "unknown" in err.lower(), f"code={code}")

# operations get: failed -> exit 3; arbitrary state -> exit 4 (never exit 0)
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    code, out, err = full_flow(
        td, srv, ["--lessons-json",
                  json.dumps([{"date": "2030-10-05", "state": "cancelled"}])])
    assert code == 0, (code, err)
    srv.get_state = "failed"
    code, out, err = run_main(
        base_v2(td) + ["operations", "get", "--request-key", KEY])
    failed_ok = (code == 3 and "timetable_resource_conflict" in err)
    srv.get_state = "weird"
    code2, out2, err2 = run_main(
        base_v2(td) + ["operations", "get", "--request-key", KEY])
    check("v2 get failed -> exit 3; get arbitrary state -> exit 4",
          failed_ok and code2 == 4 and "UNCONFIRMED" in err2,
          f"failed={code} weird={code2}")

# commit 200 with HTML body -> exit 4 UNCONFIRMED, raw body NOT shown,
# same-key GET recovers
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.commit_raw = b"<html><body>proxy error</body></html>"
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    html_hidden = "<html>" not in out and "<html>" not in err
    unconfirmed = code == 4 and "UNCONFIRMED" in err and KEY in err
    srv.commit_raw = None
    code2, out2, err2 = run_main(
        base_v2(td) + ["operations", "get", "--request-key", KEY])
    recovers = code2 == 0 and len(_commit_posts(srv)) == 1
    check("v2 commit 200 HTML -> exit 4, body hidden, same-key GET -> exit 0",
          html_hidden and unconfirmed and recovers,
          f"code={code} get={code2}")

# commit 200 with non-UTF8 body -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.commit_raw = b"\xff\xfe binary \x00 garbage"
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 commit 200 non-UTF8 -> exit 4 UNCONFIRMED",
          code == 4 and "UNCONFIRMED" in err, f"code={code}")

# commit 200 with JSON array body -> exit 4
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.commit_raw = b"[1,2,3]"
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 commit 200 JSON array -> exit 4 UNCONFIRMED",
          code == 4 and "UNCONFIRMED" in err, f"code={code}")

# socket timeout during commit POST -> exit 4 UNCONFIRMED, key preserved
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    srv.raise_in_handler = TimeoutError("timed out")
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    jp = journal_path(td, "2")
    rec = None
    for line in open(jp):
        r = json.loads(line)
        if r.get("requestKey") == KEY and r.get("kind", "commit") == "commit":
            rec = r
    check("v2 commit socket timeout -> exit 4, key preserved",
          code == 4 and "UNCONFIRMED" in err and KEY in err
          and rec is not None, f"code={code}")

# explicit --idempotency-key equal to the recorded key: GET first, 0 new POSTs
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    code, out, err = full_flow(
        td, srv, ["--lessons-json",
                  json.dumps([{"date": "2030-10-05", "state": "cancelled"}])])
    assert code == 0, (code, err)
    posts_before = len(_commit_posts(srv))
    code2, out2, err2 = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    posts_after = len(_commit_posts(srv))
    gets = [c for c in srv.calls
            if c[0] == "GET" and c[1] == f"/api/v2/operations/{KEY}"]
    check("v2 explicit same key -> GET only, 0 new POSTs",
          code2 == 0 and posts_after == posts_before and len(gets) >= 1,
          f"code={code2} posts={posts_before}->{posts_after}")

# corrupt journal line -> exit 4 UNCONFIRMED, 0 POSTs
with tempfile.TemporaryDirectory() as td:
    srv = Server()
    _preview_ok_v2(td, srv)
    jp = journal_path(td, "2")
    with open(jp, "a", encoding="utf-8") as fh:
        fh.write("{corrupted jsonl line\n")
    code, out, err = run_main(
        base_v2(td) + ["operations", "commit", "--preview-token", "pv-1",
                       "--idempotency-key", KEY])
    check("v2 corrupt journal -> exit 4, 0 POSTs",
          code == 4 and "UNCONFIRMED" in err
          and "corrupt" in err.lower() and not _commit_posts(srv),
          f"code={code}")

# canonical origin: different ports -> different dirs; userinfo/query/fragment
# refused
_d1 = mod.canonical_origin_dir("https://api.example.test/api/v2")
_d2 = mod.canonical_origin_dir("https://api.example.test:8443/api/v2")
_d3 = mod.canonical_origin_dir("https://api.example.test:9443/api/v2")
_ports_ok = (_d1 != _d2 and _d2 != _d3
             and _d1.startswith("api.example.test_443_"))
_refused = True
for _bad in ("https://user@api.example.test/api/v2",
             "https://api.example.test/api/v2?x=1",
             "https://api.example.test/api/v2#frag"):
    try:
        mod.canonical_origin_dir(_bad)
        _refused = False
    except SystemExit as _e:
        _refused = _refused and _e.code == 2
check("v2 canonical origin splits ports, rejects userinfo/query/fragment",
      _ports_ok and _refused)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
