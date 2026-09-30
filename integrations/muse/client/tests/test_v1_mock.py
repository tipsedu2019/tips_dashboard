#!/usr/bin/env python3
"""Mock tests for the v1 tips-admin client (52 restored v1 behaviors + 7 new).

Local-only: api_request and get_credential_id are monkeypatched; no network,
no credentials, temp journal dir. Covers base-URL/host validation, UUID/date/
time/sourceReference guards, journal (0600, canonical-origin/version/
credential partition, previewToken lookup, key-lineage fork refusal,
corruption halts as unconfirmed), redirect refusal, commit error paths
(409/422/429/401/403/unknown, real-server failed/unknown receipt shapes,
arbitrary states), preview-expectation recording and matching, slot
normalization, health/classes/operations reads, and the publicCache
auxiliary-state display.
"""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import stat
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

SKILL_BIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "bin", "tips-admin")


def load_cli():
    loader = importlib.machinery.SourceFileLoader("tips_admin_under_test", SKILL_BIN)
    spec = importlib.util.spec_from_loader("tips_admin_under_test", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


BASE = "https://api.test.invalid/api/v1"
HOST = "api.test.invalid"
CRED = "cred-test-1"
CLASS_ID = "11111111-2222-3333-4444-555555555555"
TOKEN = "preview-token-0000-1111-2222-333333333333"
KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SLOTS = [{"weekday": 1, "startMinute": 540, "endMinute": 600,
          "teacherId": "t1", "classroomId": "r1"}]


def http_error(code, payload):
    fp = io.BytesIO(json.dumps(payload).encode())
    return urllib.error.HTTPError("https://x/", code, "err", {}, fp)


def http_error_raw(code, raw: bytes):
    """Non-JSON error body (HTML, truncated, malformed)."""
    return urllib.error.HTTPError("https://x/", code, "err", {},
                                  io.BytesIO(raw))


def preview_envelope(token=TOKEN, class_id=CLASS_ID, slots=SLOTS):
    return {"data": {"previewToken": token,
                     "expiresAt": "2030-01-01T00:00:00+09:00",
                     "before": {"id": class_id},
                     "after": {"weeklySlots": [dict(s) for s in slots]}}}


def applied_envelope(key=KEY, class_id=CLASS_ID, slots=SLOTS, state="applied",
                     pc_state=None):
    data = {"operationId": key, "state": state,
            "class": {"id": class_id,
                      "weeklySlots": [dict(s) for s in slots]}}
    if pc_state is not None:
        data["publicCache"] = {"state": pc_state}
    return {"data": data}


def failed_envelope(key=KEY, code="timetable_resource_conflict",
                    sqlstate="23P01"):
    """Real server failed receipt: no class, data.error carries code/sqlstate."""
    data = {"operationId": key, "state": "failed",
            "error": {"code": code, "sqlstate": sqlstate}}
    return {"data": data}


def unknown_envelope(key=KEY):
    """Real server unknown receipt."""
    return {"data": {"operationId": key, "state": "unknown",
                     "retryWithNewKey": False}}


class V1MockTests(unittest.TestCase):
    def setUp(self):
        self.cli = load_cli()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cli.get_credential_id = lambda *a: CRED
        # Emulate api_request's own HTTPError handling: it catches the error
        # and routes it through handle_http_error (which exits), so tests set
        # self._response to either an envelope or an HTTPError.
        self._response = None
        self.api_calls = []

        def _fake_api(base_url, allowed_hosts, credential, method, path,
                      body=None, query=None, extra_headers=None,
                      preserve_receipt_on_error=False, idempotency_key=None,
                      applied_check=None):
            self.api_calls.append((method, path))
            resp = self._response
            if isinstance(resp, urllib.error.HTTPError):
                self.cli.handle_http_error(resp, preserve_receipt_on_error,
                                           idempotency_key, applied_check)
                raise AssertionError("handle_http_error must not return")
            return resp

        self.cli.api_request = _fake_api
        os.environ["TIPS_API_ALLOWED_HOSTS"] = HOST
        self.addCleanup(os.environ.pop, "TIPS_API_ALLOWED_HOSTS", None)

    # -- helpers ---------------------------------------------------------
    def origin_dir(self):
        return self.cli.canonical_origin_dir(BASE)

    def journal_file(self):
        return self.cli.resolve_journal_file(self.tmp.name, "1",
                                             self.origin_dir(), CRED)

    def run_cli(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                self.cli.main(["--base-url", BASE, "--journal", self.tmp.name]
                              + argv)
            except SystemExit as e:
                return e.code, out.getvalue(), err.getvalue()
        return 0, out.getvalue(), err.getvalue()

    def run_raw(self, argv):
        """No injected base-url/journal: tests base-URL validation itself."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                self.cli.main(argv)
            except SystemExit as e:
                return e.code, out.getvalue(), err.getvalue()
        return 0, out.getvalue(), err.getvalue()

    def seed_preview_expectation(self, token=TOKEN, class_id=CLASS_ID,
                                 slots=SLOTS, key=KEY):
        exp = self.cli.extract_preview_expectation(
            preview_envelope(token=token, class_id=class_id, slots=slots))
        exp["kind"] = "preview"
        exp["requestKey"] = key
        self.cli.journal_write(self.journal_file(), exp)

    def seed_commit_record(self, token=TOKEN, key=KEY):
        self.cli.journal_write(self.journal_file(),
                               {"kind": "commit", "apiVersion": "1",
                                "requestKey": key, "previewToken": token,
                                "body": {"previewToken": token}})

    def commit_argv(self, token=TOKEN, key=KEY, extra=()):
        return ["operations", "commit", "--preview-token", token,
                "--idempotency-key", key] + list(extra)

    # -- 1-6: base URL / host / UUID guards -------------------------------
    def test_01_missing_base_url_rejected(self):
        code, _, _ = self.run_raw(["health"])
        self.assertEqual(code, 2)

    def test_02_http_base_url_rejected(self):
        code, _, _ = self.run_raw(["--base-url", "http://api.test.invalid/api/v1",
                                   "health"])
        self.assertEqual(code, 2)

    def test_03_host_not_in_allowed_list_rejected(self):
        code, _, _ = self.run_raw(["--base-url", "https://evil.example/api/v1",
                                   "health"])
        self.assertEqual(code, 2)

    def test_04_non_api_path_rejected(self):
        code, _, _ = self.run_raw(["--base-url", "https://api.test.invalid/other",
                                   "health"])
        self.assertEqual(code, 2)

    def test_05_bad_class_uuid_rejected(self):
        code, _, _ = self.run_cli(["classes", "get", "--id", "not-a-uuid"])
        self.assertEqual(code, 2)

    def test_06_bad_idempotency_key_uuid_rejected(self):
        code, _, _ = self.run_cli(self.commit_argv(key="not-a-uuid"))
        self.assertEqual(code, 2)

    # -- 7: calendar range guards (one method, two assertions) ------------
    def test_07_calendar_range_guards(self):
        code, _, _ = self.run_cli(["calendar", "events",
                               "--from", "2026-10-02", "--to", "2026-10-01"])
        self.assertEqual(code, 2)
        code, _, _ = self.run_cli(["calendar", "events",
                               "--from", "2026-10-01", "--to", "2026-11-05"])
        self.assertEqual(code, 2)

    # -- 8: sourceReference must be an https message link ------------------
    def test_08_source_reference_non_https_rejected(self):
        code, _, _ = self.run_cli(self.commit_argv(
            extra=("--source-reference", "not-a-link")))
        self.assertEqual(code, 2)

    # -- 9-10: time guards ------------------------------------------------
    def _preview_argv(self, start=540, end=600):
        return ["classes", "weekly-time", "preview", "--id", CLASS_ID,
                "--slot-id", "s1", "--start-minute", str(start),
                "--end-minute", str(end), "--expected-version", "v9",
                "--reason", "test"]

    def test_09_start_not_before_end_rejected(self):
        code, _, _ = self.run_cli(self._preview_argv(start=600, end=600))
        self.assertEqual(code, 2)

    def test_10_minute_out_of_range_rejected(self):
        code, _, _ = self.run_cli(self._preview_argv(start=-5, end=60))
        self.assertEqual(code, 2)

    # -- 11-14: journal ---------------------------------------------------
    def test_11_journal_file_is_0600(self):
        self.cli.journal_write(self.journal_file(), {"kind": "probe"})
        mode = stat.S_IMODE(os.stat(self.journal_file()).st_mode)
        self.assertEqual(mode, 0o600)

    def test_12_journal_partitioned_by_origin_version_credential(self):
        path = self.journal_file()
        # canonical origin dir: readable host_port prefix + sha256 fragment
        self.assertIn("api.test.invalid_443_", path)
        self.assertIn(os.sep + "v1" + os.sep, path)
        self.assertIn(CRED, path)

    def test_13_preview_token_lookup(self):
        self.cli.journal_write(self.journal_file(),
                               {"kind": "commit", "apiVersion": "1",
                                "requestKey": KEY, "previewToken": TOKEN})
        found = self.cli.journal_find_by_preview_token(self.journal_file(), TOKEN)
        self.assertIsNotNone(found)
        self.assertEqual(found.get("requestKey"), KEY)
        missing = self.cli.journal_find_by_preview_token(self.journal_file(),
                                                         "nope")
        self.assertIsNone(missing)
        # preview-expectation records live under a separate finder
        self.seed_preview_expectation()
        exp = self.cli.journal_find_preview_expectation(self.journal_file(), TOKEN)
        self.assertIsNotNone(exp)
        self.assertEqual(exp.get("classId"), CLASS_ID)

    def test_14_fork_different_key_for_same_token_refused(self):
        self.seed_commit_record(token=TOKEN, key="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
        code, _, _ = self.run_cli(self.commit_argv(token=TOKEN, key=KEY))
        self.assertEqual(code, 2)
        self.assertEqual(len(self.api_calls), 0)

    # -- 15: redirects refused --------------------------------------------
    def test_15_redirect_refused(self):
        handler = self.cli.NoRedirectHandler()
        req = urllib.request.Request("https://api.test.invalid/")
        with self.assertRaises(urllib.error.HTTPError):
            handler.redirect_request(req, None, 301, "Moved", {}, "https://x/")

    # -- 16-23: commit error paths ----------------------------------------
    def test_16_409_applied_receipt_preserved_exits_0(self):
        self.seed_preview_expectation()
        self._response = http_error(
            409, applied_envelope())
        code, out, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)
        self.assertIn("applied", out)

    def test_17_422_exits_3(self):
        self._response = http_error(
            422, {"error": {"code": "validation_failed", "message": "bad"}})
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 3)

    def test_18_429_exits_5_with_same_key_hint(self):
        self._response = http_error(
            429, {"error": {"code": "rate_limited", "message": "slow"}})
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 5)
        self.assertIn("same key", err)

    def test_19_401_exits_3(self):
        self._response = http_error(
            401, {"error": {"code": "unauthorized", "message": "no"}})
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 3)

    def test_20_403_exits_3(self):
        self._response = http_error(
            403, {"error": {"code": "forbidden", "message": "no"}})
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 3)

    def test_21_http_500_without_receipt_is_unconfirmed_single_post(self):
        # DB commit may have succeeded; response/proxy failed -> exit 4,
        # never a confirmed failure. Same key is preserved for recovery.
        self.seed_preview_expectation()
        self._response = http_error(500, {})
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)
        self.assertIn(KEY, err)
        posts = [c for c in self.api_calls
                 if c[0] == "POST" and c[1] == "/operations"]
        self.assertEqual(len(posts), 1)

    def test_22_operation_id_mismatch_exits_4(self):
        self._response = http_error(
            409, applied_envelope(key="ffffffff-ffff-ffff-ffff-ffffffffffff"))
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)

    def test_23_missing_class_id_exits_4(self):
        payload = applied_envelope()
        payload["data"]["class"] = {}
        self._response = http_error(409, payload)
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)

    # -- 24-29: preview -> commit happy path -------------------------------
    def test_24_preview_records_expectation(self):
        self._response = preview_envelope()
        code, _, _ = self.run_cli(self._preview_argv())
        self.assertEqual(code, 0)
        rec = self.cli.journal_find_preview_expectation(self.journal_file(), TOKEN)
        self.assertIsNotNone(rec)
        self.assertEqual(rec.get("classId"), CLASS_ID)
        self.assertEqual(rec.get("afterSlots"), SLOTS)
        self.assertIn("expiresAt", rec)

    def test_25_commit_applied_matching_preview_exits_0(self):
        self.seed_preview_expectation()
        self._response = applied_envelope()
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)

    def test_26_commit_wrong_class_id_exits_4(self):
        self.seed_preview_expectation()
        self._response = applied_envelope(
            class_id="22222222-2222-3333-4444-555555555555")
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)

    def test_27_commit_wrong_slots_exits_4(self):
        self.seed_preview_expectation()
        bad = [{"weekday": 3, "startMinute": 540, "endMinute": 600,
                "teacherId": "t1", "classroomId": "r1"}]
        self._response = applied_envelope(slots=bad)
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)

    def test_28_commit_without_expectation_exits_4(self):
        self._response = applied_envelope()
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)

    def test_29_commit_failed_state_exits_3(self):
        self.seed_preview_expectation()
        self._response = failed_envelope()
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 3)

    def test_29b_failed_receipt_without_error_code_is_unconfirmed(self):
        # A failed receipt without a valid data.error.code cannot be
        # confirmed as a failure -> exit 4, not exit 3.
        self.seed_preview_expectation()
        self._response = {"data": {"operationId": KEY, "state": "failed"}}
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)

    # -- 30-33: slot normalization -----------------------------------------
    def test_30_legacy_slot_id_change_ignored(self):
        self.seed_preview_expectation()
        got = [dict(SLOTS[0], id="slot-9")]
        self._response = applied_envelope(slots=got)
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)

    def test_31_slot_order_ignored(self):
        two = SLOTS + [{"weekday": 3, "startMinute": 540, "endMinute": 600,
                        "teacherId": "t2", "classroomId": "r2"}]
        self.seed_preview_expectation(slots=two)
        self._response = applied_envelope(slots=list(reversed(two)))
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)

    def test_32_version_and_timestamp_ignored(self):
        self.seed_preview_expectation()
        got = [dict(SLOTS[0], version=7, updatedAt="2030-01-01T00:00:00Z")]
        self._response = applied_envelope(slots=got)
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)

    def test_33_normalized_slots_compare_ok(self):
        self.seed_preview_expectation()
        got = [{"weekday": 1, "start": "09:00", "end": "10:00",
                "startMinute": 540, "endMinute": 600,
                "teacherId": "t1", "classroomId": "r1",
                "storage": "normalized"}]
        self._response = applied_envelope(slots=got)
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)

    # -- 34-39: reads ------------------------------------------------------
    def test_34_health_exits_0(self):
        self._response = {"data": {"apiVersion": "1",
                                           "credentialId": CRED}}
        code, out, _ = self.run_cli(["health"])
        self.assertEqual(code, 0)
        self.assertIn("apiVersion", out)

    def test_35_classes_search_exits_0(self):
        self._response = {"data": {"classes": [{"id": CLASS_ID}]}}
        code, _, _ = self.run_cli(["classes", "search", "--search", "x"])
        self.assertEqual(code, 0)

    def test_36_classes_search_page_zero_rejected(self):
        code, _, _ = self.run_cli(["classes", "search", "--page", "0"])
        self.assertEqual(code, 2)

    def test_37_classes_get_exits_0(self):
        self._response = {"data": {"class": {"id": CLASS_ID}}}
        code, _, _ = self.run_cli(["classes", "get", "--id", CLASS_ID])
        self.assertEqual(code, 0)

    def test_38_classes_get_on_v2_base_rejected(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                self.cli.main(["--base-url",
                               "https://api.test.invalid/api/v2",
                               "--journal", self.tmp.name,
                               "classes", "get", "--id", CLASS_ID])
            except SystemExit as e:
                code = e.code
        self.assertEqual(code, 2)

    # -- 39-41: operations get/list ----------------------------------------
    def test_39_operations_get_applied_exits_0(self):
        self.seed_preview_expectation()
        self.seed_commit_record()
        self._response = applied_envelope()
        code, _, _ = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 0)

    def test_40_operations_get_unknown_exits_4(self):
        self.seed_commit_record()
        payload = applied_envelope(state="unknown")
        self._response = payload
        code, _, _ = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 4)

    def test_41_commit_replay_queries_existing_key_no_new_post(self):
        self.seed_preview_expectation()
        self.seed_commit_record()
        self._response = applied_envelope()
        code, _, err = self.run_cli(["operations", "commit", "--preview-token",
                                 TOKEN])
        self.assertEqual(code, 0)
        self.assertEqual(len(self.api_calls), 1)
        self.assertIn("no new POST sent", err)

    # -- 42-47: publicCache auxiliary state ---------------------------------
    def test_42_applied_pending_publiccache_exits_0_with_separate_note(self):
        self.seed_preview_expectation()
        self._response = applied_envelope(pc_state="pending")
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)
        self.assertIn("publicCache=pending", err)

    def test_43_applied_invalidated_publiccache_exits_0_with_separate_note(self):
        self.seed_preview_expectation()
        self._response = applied_envelope(pc_state="invalidated")
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)
        self.assertIn("publicCache=invalidated", err)

    def test_44_applied_without_publiccache_is_silent(self):
        self.seed_preview_expectation()
        self._response = applied_envelope()
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)
        self.assertNotIn("publicCache", err)

    def test_45_applied_unknown_publiccache_value_is_silent(self):
        self.seed_preview_expectation()
        self._response = applied_envelope(pc_state="bogus")
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)
        self.assertNotIn("publicCache", err)

    def test_46_get_applied_pending_publiccache_notes_separately(self):
        self.seed_preview_expectation()
        self.seed_commit_record()
        self._response = applied_envelope(pc_state="pending")
        code, _, err = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 0)
        self.assertIn("publicCache=pending", err)

    def test_47_pending_publiccache_does_not_skip_preview_verification(self):
        self.seed_preview_expectation()
        bad = [{"weekday": 3, "startMinute": 540, "endMinute": 600,
                "teacherId": "t1", "classroomId": "r1"}]
        self._response = applied_envelope(slots=bad, pc_state="pending")
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)

    # -- 48-52: 5xx without durable receipt (new client rule) --------------
    def test_48_same_key_get_recovers_unconfirmed_commit(self):
        self.seed_preview_expectation()
        self._response = http_error(500, {})
        code, _, _ = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        # same key GET -> applied and matches the preview expectation -> 0
        self._response = applied_envelope()
        code, _, _ = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 0)
        posts = [c for c in self.api_calls
                 if c[0] == "POST" and c[1] == "/operations"]
        self.assertEqual(len(posts), 1)

    def test_49_get_receipt_5xx_is_still_unconfirmed(self):
        self.seed_preview_expectation()
        self.seed_commit_record()
        self._response = http_error(503, {})
        code, _, err = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)
        self.assertIn(KEY, err)

    def test_50_503_html_body_is_unconfirmed_same_key_preserved(self):
        self.seed_preview_expectation()
        self._response = http_error_raw(
            503, b"<html><body>Bad Gateway</body></html>")
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)
        rec = self.cli.journal_find_commit_by_request_key(
            self.journal_file(), KEY)
        self.assertIsNotNone(rec)
        self.assertEqual(rec.get("previewToken"), TOKEN)

    def test_51_502_malformed_json_is_unconfirmed_same_key_preserved(self):
        self.seed_preview_expectation()
        self._response = http_error_raw(502, b"{not json")
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)
        rec = self.cli.journal_find_commit_by_request_key(
            self.journal_file(), KEY)
        self.assertIsNotNone(rec)

    def test_52_agent_ambiguous_lesson_exits_3(self):
        self._response = http_error(
            422, {"error": {"code": "agent_ambiguous_lesson",
                            "message": "multiple sessions on date"}})
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 3)
        self.assertIn("ambiguous", err.lower())

    # -- 53-58: real-server receipt shapes, explicit-key recovery,
    #           canonical origin, journal corruption --------------------------
    def test_53_commit_200_failed_receipt_exits_3(self):
        # Real failed receipt has NO class; key + valid error.code -> exit 3.
        self.seed_preview_expectation()
        self._response = failed_envelope()
        code, out, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 3)
        self.assertIn("timetable_resource_conflict", err)
        self.assertIn("23P01", err)
        self.assertIn(KEY, out)  # receipt preserved on stdout

    def test_54_commit_200_unknown_receipt_exits_4(self):
        self.seed_preview_expectation()
        self._response = unknown_envelope()
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        self.assertIn("unknown", err.lower())

    def test_55_operations_get_failed_exits_3_arbitrary_state_exits_4(self):
        self.seed_commit_record()
        self._response = failed_envelope()
        code, _, err = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 3)
        self.assertIn("timetable_resource_conflict", err)
        # Arbitrary state never ends in exit 0 (or exit 3): UNCONFIRMED.
        self._response = {"data": {"operationId": KEY, "state": "weird"}}
        code, _, err = self.run_cli(["operations", "get", "--request-key", KEY])
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)

    def test_56_commit_explicit_same_key_queries_existing_no_repost(self):
        # Explicit --idempotency-key equal to the recorded key: GET first,
        # zero POSTs -- same rule as the implicit replay path.
        self.seed_preview_expectation()
        self.seed_commit_record()
        self._response = applied_envelope()
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 0)
        posts = [c for c in self.api_calls
                 if c[0] == "POST" and c[1] == "/operations"]
        gets = [c for c in self.api_calls if c[0] == "GET"]
        self.assertEqual(posts, [])
        self.assertEqual(len(gets), 1)

    def test_57_corrupt_journal_halts_unconfirmed_no_post(self):
        self.seed_commit_record()
        with open(self.journal_file(), "a", encoding="utf-8") as fh:
            fh.write("{corrupted jsonl line\n")
        code, _, err = self.run_cli(self.commit_argv())
        self.assertEqual(code, 4)
        self.assertIn("UNCONFIRMED", err)
        self.assertIn("corrupt", err.lower())
        self.assertEqual(self.api_calls, [])

    def test_58_canonical_origin_splits_ports_and_rejects_extras(self):
        d_default = self.cli.canonical_origin_dir("https://api.test.invalid/api/v1")
        d_8443 = self.cli.canonical_origin_dir("https://api.test.invalid:8443/api/v1")
        d_9443 = self.cli.canonical_origin_dir("https://api.test.invalid:9443/api/v1")
        self.assertTrue(d_default.startswith("api.test.invalid_443_"))
        self.assertNotEqual(d_default, d_8443)
        self.assertNotEqual(d_8443, d_9443)
        for bad in ("https://user@api.test.invalid/api/v1",
                    "https://api.test.invalid/api/v1?x=1",
                    "https://api.test.invalid/api/v1#frag"):
            with self.assertRaises(SystemExit) as cm:
                self.cli.canonical_origin_dir(bad)
            self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
