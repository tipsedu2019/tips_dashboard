#!/usr/bin/env python3
"""Run the pinned Muse calendar client mocks without network or credential access."""

import hashlib
import json
import os
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
for name in list(os.environ):
    if name.startswith("TIPS_API_") or name == "JARVIS_AUTHD_SOCK":
        del os.environ[name]

attempts = []


def prohibit_external_io(event, args):
    if event in {
        "socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto",
        "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn",
    }:
        attempts.append(event)
        raise RuntimeError(f"Offline client tests prohibit {event}")


sys.addaudithook(prohibit_external_io)
manifest = json.loads((ROOT.parent / "manifest.json").read_text())
for name, expected in manifest["reviewedFiles"].items():
    actual = hashlib.sha256((ROOT.parent / name).read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f"Pinned client hash mismatch: {name}")
for name in ("test_cal_mock.py",):
    sys.argv = [str(ROOT / name)]
    try:
        runpy.run_path(sys.argv[0], run_name="__main__")
    except SystemExit as exc:
        if exc.code:
            raise
    if attempts:
        raise RuntimeError(f"Unexpected external I/O attempts: {attempts}")

print("Offline client suites passed; no network, credential socket, or subprocess attempts.")
