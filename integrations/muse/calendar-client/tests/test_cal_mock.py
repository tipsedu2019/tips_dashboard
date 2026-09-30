#!/usr/bin/env python3
"""Offline mock tests for the tips-cal draft candidate.

No network: every test monkeypatches tips_cal.api_request with a fake
transport. Run: python3 tests/test_cal_mock.py
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timezone, timedelta
from importlib.machinery import SourceFileLoader

BIN = os.path.join(os.path.dirname(__file__), "..", "bin", "tips-cal")
tips_cal = SourceFileLoader("tips_cal", os.path.abspath(BIN)).load_module()

SCHOOL = "ab290000-0000-4000-8000-000000000001"
BASE = "https://calendar.example.test/api/v2"
CRED_ID = "12345678-1234-1234-1234-1234567890ab"
BEFORE_HASH = "b" * 64
BEFORE_VER = "a" * 64  # == ns() default expected_version
AFTER_HASH = "c" * 64
AFTER_VER = "d" * 64
OTHER_SCHOOL = "ab290000-0000-4000-8000-000000000099"


def checked_at(days_ago=1):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def ev(**kw):
    base = {
        "title": "1학기 중간고사",
        "type": "시험기간",
        "start": "2026-04-24",
        "end": "2026-04-26",
        "grade": "고1",
        "source": {
            "url": "https://daego.example.kr/board/schedule/42",
            "title": "2026학년도 학사일정",
            "authority": "official_school",
            "checkedAt": checked_at(),
            "schoolIdentityEvidence": "학교 홈페이지 학사일정 게시판에서 학교명·주소 확인",
        },
    }
    base.update(kw)
    return base


def health_envelope(mode="all", scopes=("calendar:read", "calendar:write")):
    data = {
        "apiVersion": "2",
        "credentialId": CRED_ID,
        "scopes": list(scopes),
        "classIds": [],
        "expiresAt": "2026-10-01T00:00:00Z",
        "timezone": "Asia/Seoul",
        "classAccess": {"mode": mode, "includesFutureClasses": True},
    }
    if mode == "selected":
        data["classIds"] = ["ab290000-0000-4000-8000-000000000010"]
    return (200, {"data": data, "error": None})


class FakeTransport:
    """Canned (status, envelope) keyed by (method, path-prefix)."""

    def __init__(self):
        self.calls = []
        self.routes = []

    def add(self, method, prefix, status, envelope):
        self.routes.append((method, prefix, status, envelope))

    def __call__(self, base_url, allowed_hosts, credential, method, path, *,
                 body=None, idempotency_key=None, timeout=30):
        self.calls.append({"method": method, "path": path, "body": body,
                           "idempotency_key": idempotency_key,
                           "base_url": base_url})
        for m, prefix, status, envelope in self.routes:
            if m == method and path.startswith(prefix):
                return status, envelope() if callable(envelope) else envelope
        raise AssertionError(f"unexpected {method} {path}")


class CalTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.fake = FakeTransport()
        self._orig = tips_cal.api_request
        tips_cal.api_request = self.fake
        self.fake.add("GET", "/health", *health_envelope())

    def tearDown(self):
        tips_cal.api_request = self._orig

    def ctx(self):
        return tips_cal.Ctx(BASE, "cred", self.tmp)

    def ns(self, **kw):
        d = {"school_id": SCHOOL, "school_year": 2026,
             "expected_version": "a" * 64, "reason": "mock",
             "events_json": "", "events_file": "",
             "preview_token": "", "idempotency_key": "",
             "source_reference": "", "request_key": "",
             "search": "", "page": 1}
        d.update(kw)
        return type("NS", (), d)()

    def invoke(self, fn, *a):
        out, err = io.StringIO(), io.StringIO()
        try:
            with redirect_stdout(out), redirect_stderr(err):
                code = fn(*a)
        except SystemExit as e:
            code = e.code
        return code, out.getvalue(), err.getvalue()

    def posts_to(self, prefix):
        return [c for c in self.fake.calls
                if c["method"] == "POST" and c["path"].startswith(prefix)]

    # ---- health / classAccess display

    def test_health_all_grant(self):
        code, out, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        self.assertIn("classAccess.mode = all", out)
        self.assertIn("EXPLICIT GRANT", out)
        self.assertIn("future classes", out)

    def test_health_selected_grant(self):
        self.fake.routes = []
        self.fake.add("GET", "/health", *health_envelope(mode="selected"))
        code, out, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        self.assertIn("classAccess.mode = selected", out)
        self.assertIn("ab290000-0000-4000-8000-000000000010", out)

    def test_health_legacy_all_read_grant(self):
        self.fake.routes = []
        self.fake.add("GET", "/health", *health_envelope(mode="legacy_all_read"))
        code, out, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        self.assertIn("legacy_all_read", out)
        self.assertIn("Class writes are NEVER authorized", out)
        self.assertIn("calendar permissions are independent", out)

    def test_health_401_denied(self):
        self.fake.routes = []
        self.fake.add("GET", "/health", 401,
                      {"data": None, "error": {"code": "agent_unauthorized"}})
        code, _, err = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 3)
        self.assertIn("agent_unauthorized", err)

    # ---- validation (client-side, exit 2, no request beyond health)

    def _preview_calls(self):
        return self.posts_to("/calendar/changes/preview")

    def _journal_kinds(self, kind):
        entries = tips_cal.journal_read_all(
            tips_cal.journal_path(self.tmp,
                                  tips_cal.canonical_origin_dir(BASE),
                                  CRED_ID))
        return [e for e in entries if e["kind"] == kind]

    def test_preview_rejects_too_many_events(self):
        events = [ev(title=f"e{i}") for i in range(101)]
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps(events)))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_bad_type(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(type="소풍")])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_stale_checked_at(self):
        bad = ev()
        bad["source"]["checkedAt"] = checked_at(days_ago=31)
        code, _, err = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertIn("30 days", err)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_future_checked_at(self):
        bad = ev()
        bad["source"]["checkedAt"] = (
            datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_bad_grade(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(grade="대학생")])))
        self.assertEqual(code, 2)

    def test_preview_rejects_all_combined_grade(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(grade="all,고1")])))
        self.assertEqual(code, 2)

    def test_preview_accepts_comma_grades(self):
        self._add_preview_route()
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(grade="고1,고2,고3")])))
        self.assertEqual(code, 0)
        self.assertEqual(len(self._preview_calls()), 1)

    def test_preview_rejects_outside_school_year(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps(
                [ev(start="2027-03-01", end="2027-03-02")])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_bad_authority(self):
        bad = ev()
        bad["source"]["authority"] = "blog"
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)

    def test_preview_rejects_missing_evidence(self):
        bad = ev()
        del bad["source"]["schoolIdentityEvidence"]
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)

    def test_preview_accepts_http_source_url(self):
        self._add_preview_route()
        bad = ev()
        bad["source"]["url"] = "http://daego.example.kr/x"
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 0)
        self.assertEqual(len(self._preview_calls()), 1)

    def test_preview_rejects_url_with_credentials(self):
        bad = ev()
        bad["source"]["url"] = "https://user:pass@daego.example.kr/x"
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_accepts_small_future_skew(self):
        self._add_preview_route()
        bad = ev()
        bad["source"]["checkedAt"] = (
            datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat()
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 0)

    def test_preview_accepts_exam_term_enum(self):
        self._add_preview_route()
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(examTerm="1학기 중간")])))
        self.assertEqual(code, 0)

    def test_preview_rejects_bad_exam_term(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(examTerm="1학기 중간고사")])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_long_evidence(self):
        bad = ev()
        bad["source"]["schoolIdentityEvidence"] = "x" * 501
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)

    def test_preview_rejects_bad_conflict_resolution(self):
        for bad_cr in ["", "   ", "x" * 501]:
            bad = ev(conflictResolution=bad_cr)
            code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
                self.ns(events_json=json.dumps([bad])))
            self.assertEqual(code, 2, bad_cr[:10])
        self.assertEqual(self._preview_calls(), [])

    def test_preview_accepts_conflict_resolution(self):
        self._add_preview_route()
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps(
                [ev(conflictResolution="교육청 공지보다 학교 홈페이지 최신 공지가 우선")])))
        self.assertEqual(code, 0)

    def test_preview_rejects_science_key_non_highschool(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps(
                [ev(grade="중3", scienceAreaKey="physics")])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_201_is_indeterminate(self):
        self.fake.add("POST", "/calendar/changes/preview", 201,
                      {"data": {"previewToken":
                                "aa16abf1-1222-4d7e-a257-b1605e763391",
                                "after": {"verificationHash": "h"}},
                       "error": None})
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)

    def test_preview_metadata_invalid_422(self):
        self.fake.add("POST", "/calendar/changes/preview", 422,
                      {"data": None,
                       "error": {"code": "agent_calendar_metadata_invalid"}})
        code, _, err = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 3)
        self.assertIn("agent_calendar_metadata_invalid", err)

    def test_scope_gate_blocks_write(self):
        self.fake.routes = []
        self.fake.add("GET", "/health",
                      *health_envelope(scopes=("calendar:read",)))
        code, _, err = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 2)
        self.assertIn("calendar:write", err)
        self.assertEqual(self._preview_calls(), [])

    # ---- preview success / journal

    def _ws(self, verification_hash=AFTER_HASH, version=AFTER_VER,
            school_id=None, school_year=2026, category="고등학교",
            timezone="Asia/Seoul", science_areas="default"):
        """Actual calendar workspace shape (strict: 64-lower-hex
        version/hash, list scienceAreas, Asia/Seoul)."""
        return {
            "school": {"id": school_id or SCHOOL, "name": "대기고등학교",
                       "category": category},
            "schoolYear": school_year,
            "events": [{"title": "1학기 중간고사", "type": "시험기간",
                        "start": "2026-04-24", "end": "2026-04-26",
                        "grade": "고1"}],
            "version": version,
            "verificationHash": verification_hash,
            "timezone": timezone,
            "scienceAreas": [] if science_areas == "default" else science_areas,
        }

    def _add_preview_route(self, token="aa16abf1-1222-4d7e-a257-b1605e763391",
                           before=None, after=None):
        before = self._ws(BEFORE_HASH, BEFORE_VER) if before is None else before
        after = self._ws(AFTER_HASH, AFTER_VER) if after is None else after
        self.fake.add("POST", "/calendar/changes/preview", 200, {
            "data": {
                "previewToken": token,
                "expiresAt": "2026-09-30T09:10:30+00:00",
                "before": before,
                "after": after,
                "diff": {"added": [{"title": "1학기 중간고사"}],
                         "changed": [], "unchanged": []},
            },
            "error": None,
        })

    def test_preview_success_records_journal(self):
        self._add_preview_route()
        code, out, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 0)
        self.assertIn("aa16abf1-1222-4d7e-a257-b1605e763391", out)
        entries = tips_cal.journal_read_all(
            tips_cal.journal_path(self.tmp,
                                  tips_cal.canonical_origin_dir(BASE),
                                  CRED_ID))
        previews = [e for e in entries if e["kind"] == "cal_preview"]
        self.assertEqual(len(previews), 1)
        self.assertEqual(previews[0]["afterHash"], AFTER_HASH)

    def test_preview_stale_version_no_journal(self):
        self.fake.add("POST", "/calendar/changes/preview", 409,
                      {"data": None,
                       "error": {"code": "agent_stale", "sqlstate": "P0001"}})
        code, _, err = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 3)
        self.assertIn("agent_stale", err)
        entries = tips_cal.journal_read_all(
            tips_cal.journal_path(self.tmp,
                                  tips_cal.canonical_origin_dir(BASE),
                                  CRED_ID))
        self.assertEqual([e for e in entries
                          if e["kind"] == "cal_preview"], [])

    def test_preview_source_conflict_409(self):
        self.fake.add("POST", "/calendar/changes/preview", 409,
                      {"data": None,
                       "error": {"code": "agent_calendar_source_conflict"}})
        code, _, err = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 3)
        self.assertIn("agent_calendar_source_conflict", err)

    def test_preview_match_required_409(self):
        self.fake.add("POST", "/calendar/changes/preview", 409,
                      {"data": None,
                       "error": {"code": "agent_calendar_match_required"}})
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 3)

    def test_preview_source_stale_422(self):
        self.fake.add("POST", "/calendar/changes/preview", 422,
                      {"data": None,
                       "error": {"code": "agent_calendar_source_stale"}})
        code, _, err = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 3)
        self.assertIn("agent_calendar_source_stale", err)

    def test_preview_5xx_indeterminate(self):
        self.fake.add("POST", "/calendar/changes/preview", 503,
                      {"data": None, "error": {"code": "proxy_error"}})
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)

    # ---- commit flow

    def _preview_then(self, token="aa16abf1-1222-4d7e-a257-b1605e763391"):
        self._add_preview_route(token)
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 0)
        return token

    def _add_commit_route(self, key, state="applied", after=AFTER_HASH,
                          code=None, school_id=None, school_year=2026,
                          op_id=None, kind="calendar"):
        op_id = op_id or key
        if state == "applied":
            data = {"operationId": op_id, "kind": kind, "state": "applied",
                    "calendar": self._ws(after, AFTER_VER, school_id,
                                         school_year)}
            envelope = {"data": data, "error": None}
        elif state == "failed":
            # Durable failed receipt: HTTP 200, data.state=failed,
            # top-level error = data.error.
            err = {"code": code, "sqlstate": "P0001"} if code else None
            data = {"operationId": op_id, "kind": kind, "state": "failed",
                    "error": err}
            envelope = {"data": data, "error": err}
        else:  # unknown
            data = {"operationId": op_id, "kind": kind, "state": "unknown",
                    "retryWithNewKey": False}
            envelope = {"data": data, "error": None}
        self.fake.add("POST", "/calendar/operations", 200, envelope)
        self.fake.add("GET", f"/calendar/operations/{key}", 200, envelope)

    def test_commit_applied_hash_match(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key)
        code, out, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 0)
        self.assertIn(AFTER_HASH, out)
        self.assertEqual(len(self.posts_to("/calendar/operations")), 1)

    def test_commit_applied_hash_mismatch_exit4(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, after="e" * 64)
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_commit_failed_receipt_exit3(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, state="failed",
                               code="agent_calendar_source_conflict")
        code, _, err = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 3)
        self.assertIn("agent_calendar_source_conflict", err)

    def test_commit_failed_no_code_exit4(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, state="failed", code=None)
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_commit_unknown_exit4(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, state="unknown")
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_commit_replay_zero_post(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key)
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.posts_to("/calendar/operations")), 1)
        # second commit, explicit same key -> GET first, 0 new POSTs
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.posts_to("/calendar/operations")), 1)

    def test_commit_same_key_different_body_refused(self):
        token_a = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key)
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token_a, idempotency_key=key))
        self.assertEqual(code, 0)
        # a DIFFERENT preview token reusing the same key -> refuse before send
        token_b = "bb27bc82-3333-4d4e-b257-c27107d136a2"
        self.fake.routes = [r for r in self.fake.routes
                            if not (r[0] == "POST"
                                    and r[1] == "/calendar/changes/preview")]
        self._add_preview_route(token_b)
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev(title="다른 일정")])))
        self.assertEqual(code, 0)
        posts_before = len(self.posts_to("/calendar/operations"))
        code, _, err = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token_b, idempotency_key=key))
        self.assertEqual(code, 2)
        self.assertIn("different content", err)
        self.assertEqual(len(self.posts_to("/calendar/operations")),
                         posts_before)

    def test_commit_without_preview_exit4(self):
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token="aa16abf1-1222-4d7e-a257-b1605e763391",
                    idempotency_key="5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"))
        self.assertEqual(code, 4)
        self.assertEqual(self.posts_to("/calendar/operations"), [])

    def test_operations_get_applied_with_journal(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key)
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 0)
        code, out, _ = self.invoke(            tips_cal.cmd_calendar_operations_get, self.ctx(),
            self.ns(request_key=key))
        self.assertEqual(code, 0)
        self.assertIn(key, out)

    def test_operations_get_applied_without_journal_exit4(self):
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key)
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_get, self.ctx(),
            self.ns(request_key=key))
        self.assertEqual(code, 4)

    def test_operations_get_unknown_exit4(self):
        key = "66b4b077-14a1-4fd3-9e26-0da4e21cd02a"
        self.fake.add("GET", f"/calendar/operations/{key}", 200,
                      {"data": {"operationId": key, "kind": "calendar",
                                "state": "unknown", "retryWithNewKey": False},
                       "error": None})
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_operations_get, self.ctx(),
            self.ns(request_key=key))
        self.assertEqual(code, 4)

    def test_broken_json_envelope_exit4(self):
        self.fake.routes = [r for r in self.fake.routes
                            if not (r[0] == "GET" and r[1] == "/health")]
        self.fake.add("GET", "/health", 200, None)  # not a dict
        code, _, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 4)

    def test_journal_kinds_separate_from_class_ops(self):
        self._add_preview_route()
        code, _, _ = self.invoke(            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 0)
        jp = tips_cal.journal_path(self.tmp,
                                   tips_cal.canonical_origin_dir(BASE),
                                   CRED_ID)
        self.assertTrue(jp.endswith("calendar-operations.jsonl"))
        self.assertFalse(os.path.exists(
            jp.replace("calendar-operations.jsonl", "operations.jsonl")))

    def test_operations_list(self):
        self.fake.add("GET", "/calendar/operations", 200,
                      {"data": {"items": [
                          {"operationId": "k1", "kind": "calendar",
                           "state": "applied"}]}, "error": None})
        code, out, _ = self.invoke(            tips_cal.cmd_calendar_operations_list, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        self.assertIn("k1", out)

    def test_schools_list(self):
        self.fake.add("GET", "/calendar/schools", 200,
                      {"data": {"items": [
                          {"id": SCHOOL, "name": "대기고등학교",
                           "category": "고등학교"}]}, "error": None})
        code, out, _ = self.invoke(            tips_cal.cmd_calendar_schools, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        self.assertIn("대기고등학교", out)

    def test_school_get(self):
        self.fake.add("GET", f"/calendar/schools/{SCHOOL}", 200,
                      {"data": self._ws("e" * 64, "f" * 64), "error": None})
        code, out, _ = self.invoke(            tips_cal.cmd_calendar_school_get, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        self.assertIn("e" * 64, out)



    # ---- regression: independent review blockers

    def test_health_uses_v1_base(self):
        code, _, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        health_calls = [c for c in self.fake.calls if c["path"] == "/health"]
        self.assertEqual(len(health_calls), 1)
        self.assertTrue(health_calls[0]["base_url"].endswith("/api/v1"),
                        health_calls[0]["base_url"])

    def test_health_rejects_non_uuid_credential_id(self):
        self.fake.routes = [r for r in self.fake.routes
                            if not (r[0] == "GET" and r[1] == "/health")]
        data = dict(health_envelope()[1]["data"])
        data["credentialId"] = "not-a-uuid"
        self.fake.add("GET", "/health", 200, {"data": data, "error": None})
        code, _, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 4)

    def test_preview_rejects_school_year_out_of_range(self):
        for y in (1999, 2201):
            code, _, _ = self.invoke(
                tips_cal.cmd_calendar_changes_preview, self.ctx(),
                self.ns(school_year=y, events_json=json.dumps([ev()])))
            self.assertEqual(code, 2, y)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_rejects_bad_expected_version(self):
        for v in ("v1", "z" * 64, "a" * 63):
            code, _, _ = self.invoke(
                tips_cal.cmd_calendar_changes_preview, self.ctx(),
                self.ns(expected_version=v,
                        events_json=json.dumps([ev()])))
            self.assertEqual(code, 2, v)
        self.assertEqual(self._preview_calls(), [])

    def test_preview_429_stops(self):
        self.fake.add("POST", "/calendar/changes/preview", 429,
                      {"data": None, "error": {"code": "agent_rate_limited"}})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)

    def test_preview_outputs_full_workspace(self):
        self._add_preview_route()
        code, out, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 0)
        payload = json.loads(out)
        for section in ("before", "after"):
            self.assertEqual(payload[section]["school"]["id"], SCHOOL)
            self.assertIn("verificationHash", payload[section])
            self.assertIn("events", payload[section])
            self.assertIn("scienceAreas", payload[section])
        self.assertEqual(set(payload["diff"]),
                         {"added", "changed", "unchanged"})
        self.assertEqual(payload["after"]["verificationHash"], AFTER_HASH)

    def test_school_get_outputs_full_workspace(self):
        self.fake.add("GET", f"/calendar/schools/{SCHOOL}", 200,
                      {"data": self._ws("e" * 64, "f" * 64), "error": None})
        code, out, _ = self.invoke(
            tips_cal.cmd_calendar_school_get, self.ctx(), self.ns())
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["verificationHash"], "e" * 64)
        self.assertEqual(payload["school"]["name"], "대기고등학교")
        self.assertIn("events", payload)
        self.assertIn("scienceAreas", payload)

    def test_receipt_rejects_wrong_school_id(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(
            key, school_id="ab290000-0000-4000-8000-000000000099")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_receipt_rejects_wrong_school_year(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, school_year=2027)
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_receipt_validates_operation_id_for_failed(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, state="failed",
                               code="agent_calendar_source_conflict",
                               op_id="66b4b077-14a1-4fd3-9e26-0da4e21cd02a")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_receipt_validates_kind_for_failed(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(key, state="failed",
                               code="agent_calendar_source_conflict",
                               kind="classes")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_receipt_validates_operation_id_for_unknown(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self._add_commit_route(
            key, state="unknown",
            op_id="66b4b077-14a1-4fd3-9e26-0da4e21cd02a")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)

    def test_health_5xx_plausible_data_never_success(self):
        self.fake.routes = [r for r in self.fake.routes
                            if not (r[0] == "GET" and r[1] == "/health")]
        data = dict(health_envelope()[1]["data"])
        self.fake.add("GET", "/health", 503, {"data": data, "error": None})
        code, _, _ = self.invoke(tips_cal.cmd_health, self.ctx(), self.ns())
        self.assertEqual(code, 4)

    def test_schools_5xx_plausible_data_never_success(self):
        self.fake.add("GET", "/calendar/schools", 503,
                      {"data": {"items": [{"id": SCHOOL, "name": "x",
                                           "category": "y"}]}, "error": None})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_schools, self.ctx(), self.ns())
        self.assertEqual(code, 4)

    def test_operations_get_5xx_plausible_receipt_never_success(self):
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self.fake.add("GET", f"/calendar/operations/{key}", 503,
                      {"data": {"operationId": key, "kind": "calendar",
                                "state": "applied",
                                "calendar": self._ws(AFTER_HASH)},
                       "error": None})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_get, self.ctx(),
            self.ns(request_key=key))
        self.assertEqual(code, 4)

    def test_read_200_with_error_not_null(self):
        self.fake.add("GET", "/calendar/schools", 200,
                      {"data": {"items": []},
                       "error": {"code": "agent_write_failed"}})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_schools, self.ctx(), self.ns())
        self.assertEqual(code, 4)

    def test_operations_get_requires_write_scope(self):
        self.fake.routes = [r for r in self.fake.routes
                            if not (r[0] == "GET" and r[1] == "/health")]
        self.fake.add("GET", "/health",
                      *health_envelope(scopes=("calendar:read",)))
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        code, _, err = self.invoke(
            tips_cal.cmd_calendar_operations_get, self.ctx(),
            self.ns(request_key=key))
        self.assertEqual(code, 2)
        self.assertIn("calendar:write", err)
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_list, self.ctx(), self.ns())
        self.assertEqual(code, 2)
        self.assertEqual([c for c in self.fake.calls
                          if c["path"].startswith("/calendar/operations")], [])

    def test_reject_codes_recognized(self):
        pairs = [(400, "invalid_request"), (422, "agent_invalid"),
                 (422, "agent_invalid_range"), (422, "agent_invalid_catalog"),
                 (404, "agent_not_found"), (403, "agent_forbidden"),
                 (409, "agent_no_change"),
                 (409, "agent_approval_workflow_required"),
                 (409, "agent_preview_expired"),
                 (409, "agent_preview_consumed"),
                 (409, "agent_idempotency_key_reused"),
                 (409, "agent_write_failed")]
        for status, code in pairs:
            fake = FakeTransport()
            fake.add("GET", "/health", *health_envelope())
            fake.add("POST", "/calendar/changes/preview", status,
                     {"data": None, "error": {"code": code}})
            tips_cal.api_request = fake
            try:
                c, _, err = self.invoke(
                    tips_cal.cmd_calendar_changes_preview, self.ctx(),
                    self.ns(events_json=json.dumps([ev()])))
            finally:
                tips_cal.api_request = self.fake
            self.assertEqual(c, 3, code)
            self.assertIn(code, err)

    def test_preview_5xx_recognized_code_still_indeterminate(self):
        self.fake.add("POST", "/calendar/changes/preview", 503,
                      {"data": None,
                       "error": {"code": "agent_rate_limited"}})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)

    def test_commit_503_write_failed_then_get_establishes_failed(self):
        token = self._preview_then()
        key = "5f4e36bc-a2da-4904-a18c-4f9f7dd9a1ac"
        self.fake.add("POST", "/calendar/operations", 503,
                      {"data": None,
                       "error": {"code": "agent_write_failed"}})
        err_obj = {"code": "agent_write_failed", "sqlstate": "P0001"}
        self.fake.add("GET", f"/calendar/operations/{key}", 200,
                      {"data": {"operationId": key, "kind": "calendar",
                                "state": "failed", "error": err_obj},
                       "error": err_obj})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_operations_commit, self.ctx(),
            self.ns(preview_token=token, idempotency_key=key))
        self.assertEqual(code, 4)
        self.assertEqual(len(self.posts_to("/calendar/operations")), 1)
        code, _, err = self.invoke(
            tips_cal.cmd_calendar_operations_get, self.ctx(),
            self.ns(request_key=key))
        self.assertEqual(code, 3)
        self.assertIn("agent_write_failed", err)

    def test_science_exam_requires_key(self):
        bad = ev(type="과학시험일", grade="고1,고2")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_science_exam_rejects_all_grade(self):
        bad = ev(type="과학시험일", grade="all", scienceAreaKey="physics")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_science_exam_rejects_mixed_grades(self):
        bad = ev(type="과학시험일", grade="고1,중3", scienceAreaKey="physics")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])

    def test_science_exam_accepts(self):
        self._add_preview_route()
        good = ev(type="과학시험일", grade="고1,고2", scienceAreaKey="physics")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([good])))
        self.assertEqual(code, 0)

    def test_non_science_forbids_science_key(self):
        bad = ev(scienceAreaKey="physics")
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([bad])))
        self.assertEqual(code, 2)
        self.assertEqual(self._preview_calls(), [])



    # ---- regression: preview binding + strict shape + school-get binding

    def test_preview_rejects_wrong_before_school_id(self):
        self._add_preview_route(
            before=self._ws(BEFORE_HASH, BEFORE_VER, school_id=OTHER_SCHOOL))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_wrong_after_school_id(self):
        self._add_preview_route(
            after=self._ws(AFTER_HASH, AFTER_VER, school_id=OTHER_SCHOOL))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_wrong_before_school_year(self):
        self._add_preview_route(
            before=self._ws(BEFORE_HASH, BEFORE_VER, school_year=2027))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_wrong_after_school_year(self):
        self._add_preview_route(
            after=self._ws(AFTER_HASH, AFTER_VER, school_year=2027))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_before_version_mismatch(self):
        self._add_preview_route(
            before=self._ws(BEFORE_HASH, "e" * 64))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_null_workspace_exit4_not_5(self):
        self.fake.add("POST", "/calendar/changes/preview", 200, {
            "data": {
                "previewToken": "aa16abf1-1222-4d7e-a257-b1605e763391",
                "expiresAt": "2026-09-30T09:10:30+00:00",
                "before": None,
                "after": self._ws(AFTER_HASH, AFTER_VER),
                "diff": {"added": [], "changed": [], "unchanged": []}},
            "error": None})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_science_areas_not_list(self):
        self._add_preview_route(
            after=self._ws(AFTER_HASH, AFTER_VER, science_areas={}))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_bad_hash_format(self):
        self._add_preview_route(
            after=self._ws("not-hex", AFTER_VER))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_uppercase_hash(self):
        self._add_preview_route(
            after=self._ws("A" * 64, AFTER_VER))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_rejects_non_seoul_timezone(self):
        self._add_preview_route(
            after=self._ws(AFTER_HASH, AFTER_VER, timezone="UTC"))
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 4)
        self.assertEqual(self._journal_kinds("cal_preview"), [])

    def test_preview_accepts_null_category(self):
        self._add_preview_route(
            before=self._ws(BEFORE_HASH, BEFORE_VER, category=None),
            after=self._ws(AFTER_HASH, AFTER_VER, category=None))
        code, out, _ = self.invoke(
            tips_cal.cmd_calendar_changes_preview, self.ctx(),
            self.ns(events_json=json.dumps([ev()])))
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertIsNone(payload["after"]["school"]["category"])

    def test_school_get_rejects_wrong_id(self):
        self.fake.add("GET", f"/calendar/schools/{SCHOOL}", 200,
                      {"data": self._ws("e" * 64, "f" * 64,
                                        school_id=OTHER_SCHOOL),
                       "error": None})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_school_get, self.ctx(), self.ns())
        self.assertEqual(code, 4)

    def test_school_get_rejects_wrong_year(self):
        self.fake.add("GET", f"/calendar/schools/{SCHOOL}", 200,
                      {"data": self._ws("e" * 64, "f" * 64, school_year=2027),
                       "error": None})
        code, _, _ = self.invoke(
            tips_cal.cmd_calendar_school_get, self.ctx(), self.ns())
        self.assertEqual(code, 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
