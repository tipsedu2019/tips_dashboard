"""Consume real compiler/final-SQL DTOs through the pinned Muse CLI, offline.

This proves DTO compatibility, not Vault injection or hosted HTTP transport.
"""
import contextlib
import importlib.machinery
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

sys.dont_write_bytecode = True
for name in list(os.environ):
    if name.startswith("TIPS_API_") or name == "JARVIS_AUTHD_SOCK":
        del os.environ[name]


def offline(event, _args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto",
                 "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn"}:
        raise RuntimeError("External I/O forbidden: " + event)


sys.addaudithook(offline)
root = Path(__file__).resolve().parents[1]
cli = importlib.machinery.SourceFileLoader(
    "tips_cal", str(root / "integrations/muse/calendar-client/bin/tips-cal")
).load_module()
fixture = json.load(sys.stdin)
commits = 0


def transport(_base, _hosts, _credential, method, path, **kwargs):
    global commits
    if path == "/health":
        data = fixture["health"]
    elif path.startswith("/calendar/schools/"):
        data = fixture["fresh"] if commits else fixture["preview"]["before"]
    elif path == "/calendar/changes/preview":
        assert method == "POST" and kwargs["body"] == fixture["input"]
        data = fixture["preview"]
    elif path == "/calendar/operations" and method == "POST":
        assert kwargs["body"] == fixture["body"]
        assert kwargs["idempotency_key"] == fixture["saved"]["operationId"]
        commits += 1
        data = fixture["saved"]
    elif path == "/calendar/operations/" + fixture["saved"]["operationId"]:
        data = fixture["receipt"]
    elif path == "/calendar/operations/" + fixture["unknown"]["operationId"]:
        data = fixture["unknown"]
    else:
        raise AssertionError("Unexpected transport route: " + path)
    return 200, {"data": data, "error": None}


cli.api_request = transport


def invoke(fn, ctx, args, expected=0):
    out = io.StringIO()
    errors = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(errors):
        try:
            result = fn(ctx, args)
        except SystemExit as exc:
            result = exc.code
    assert result == expected, (fn.__name__, result, expected, errors.getvalue())
    return out.getvalue()


with tempfile.TemporaryDirectory(prefix="tips-calendar-consumer-") as journal:
    ctx = cli.Ctx("https://calendar.example.test/api/v2", "offline-no-credential", journal)
    request = fixture["input"]
    args = SimpleNamespace(school_id=request["schoolId"], school_year=request["schoolYear"],
        expected_version=request["expectedVersion"], reason=request["reason"],
        events_json=json.dumps(request["events"]), events_file="",
        preview_token=fixture["preview"]["previewToken"],
        idempotency_key=fixture["saved"]["operationId"], source_reference=fixture["body"]["sourceReference"],
        request_key=fixture["saved"]["operationId"])
    invoke(cli.cmd_calendar_school_get, ctx, args)
    invoke(cli.cmd_calendar_changes_preview, ctx, args)
    invoke(cli.cmd_calendar_operations_commit, ctx, args)
    invoke(cli.cmd_calendar_operations_get, ctx, args)
    invoke(cli.cmd_calendar_operations_commit, ctx, args)
    assert commits == 1, "Journal recovery must not send another POST"
    fresh = json.loads(invoke(cli.cmd_calendar_school_get, ctx, args))
    assert fresh["verificationHash"] == fixture["preview"]["after"]["verificationHash"]
    args.request_key = fixture["unknown"]["operationId"]
    invoke(cli.cmd_calendar_operations_get, ctx, args, expected=4)
print(json.dumps({"status": "passed", "realSqlDtosConsumedByMuseCli": True,
                  "calendarRequests": "preview/commit/receipt/fresh/replay/unknown"}))
