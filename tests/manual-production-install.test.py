"""Offline safety checks only: mocked preflight main and one synthetic owned local child. No real CLI, DB, or network."""
import ast
import copy
import importlib.util
import json
import pathlib
import tempfile
import os
import io
import contextlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/manual-production-install.py"
ast.parse(SCRIPT.read_text())
spec = importlib.util.spec_from_file_location("unrun_install_proposal", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
CFG = json.loads((ROOT / "scripts/approved-seven-migrations.json").read_text())


class OfflineSafety(unittest.TestCase):
    def enabled(self):
        cfg = copy.deepcopy(CFG)
        cfg["proposalOnly"] = False
        cfg["approvalReceiptSha256"] = "a" * 64
        env = {"INSTALL_ACK": module.ACK, "INSTALL_APPROVAL_RECEIPT_SHA256": "a" * 64,
               "RELEASE_MODE": "install",
               "GITHUB_REPOSITORY": "tipsedu2019/tips_dashboard", "GITHUB_EVENT_NAME": "workflow_dispatch",
               "SUPABASE_DB_PASSWORD": "synthetic-unit-only", "SUPABASE_ACCESS_TOKEN": "synthetic-unit-only", "GH_TOKEN": "synthetic-unit-only"}
        return cfg, env

    def test_proposal_cannot_activate(self):
        cfg, env = self.enabled()
        cfg["proposalOnly"] = True
        with patch.object(module, "api", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(module.Stop, "proposal_not_activated"):
                module.approval_gate(cfg, env)

    def test_missing_existing_password_stops_before_auth(self):
        cfg, env = self.enabled()
        del env["SUPABASE_DB_PASSWORD"]
        with patch.object(module, "api", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(module.Stop, "provided_db_password_required"):
                module.approval_gate(cfg, env)

    def test_wrong_project_is_rejected(self):
        cfg, env = self.enabled()
        cfg["target"]["projectRef"] = "wrong-target"
        with self.assertRaisesRegex(module.Stop, "wrong_target"):
            module.approval_gate(cfg, env)

    def test_changed_initial_history_rejected(self):
        with self.assertRaisesRegex(module.Stop, "initial_ledger_mismatch"):
            module.verify_initial({"versions": [{"version": "20261002170849"}], "tables": 0, "functions": 0}, CFG)

    def test_partial_objects_even_initial_ledger_rejected(self):
        rows = [{"version": r["file"][:14]} for r in CFG["allSourceMigrations"] if r["file"] not in {s["file"] for s in CFG["orderedSeven"]}]
        self.assertEqual(len(rows), 362)
        self.assertEqual(module.digest_versions(rows), CFG["before"]["versionsSha256"])
        with self.assertRaisesRegex(module.Stop, "existing_ai_objects"):
            module.verify_initial({"versions": rows, "tables": 0, "functions": 1}, CFG)

    def test_ignored_root_environment_stops_before_cli_or_auth(self):
        # Exercise the real clean-checkout gate. An ignored file must not silently
        # override the reviewed connection configuration; its contents are unread.
        fixtures = ROOT / ".codex-artifacts"
        fixtures.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=fixtures) as owned:
            source = pathlib.Path(owned)
            migrations = source / "supabase/migrations"
            migrations.mkdir(parents=True)
            cfg = copy.deepcopy(CFG)
            synthetic = b"-- offline synthetic source fixture; never executed\n"
            for row in cfg["allSourceMigrations"]:
                (migrations / row["file"]).write_bytes(synthetic)
                row["sha256"] = module.hashlib.sha256(synthetic).hexdigest()
            (source / "supabase/config.toml").write_text('project_id = "' + module.TARGET + '"\n')
            (source / ".gitignore").write_text(".env*\n")
            def git(*args):
                return module.subprocess.run(["git", *args], cwd=source, capture_output=True, text=True, check=True).stdout.strip()
            git("init", "--quiet")
            git("add", ".")
            git("-c", "user.name=Offline Fixture", "-c", "user.email=offline@example.invalid", "commit", "--quiet", "-m", "synthetic source fixture")
            cfg["approvedSourceSha"] = git("rev-parse", "HEAD")
            module.source_gate(source, cfg)
            (source / ".env.local").touch()
            self.assertEqual(git("status", "--porcelain", "--untracked-files=all"), "")
            with patch.object(module, "api", side_effect=AssertionError("network forbidden")), patch.object(module, "command", side_effect=AssertionError("CLI forbidden")):
                with self.assertRaisesRegex(module.Stop, "project_environment_forbidden"):
                    module.source_gate(source, cfg)

    def test_wrong_pooler_tenant_rejected_before_password_use(self):
        responses = [{"id": module.TARGET, "region": module.REGION, "status": "ACTIVE_HEALTHY"},
                     [{"database_type": "PRIMARY", "connection_string": "postgres://postgres.wrong@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"}]]
        with patch.object(module, "api", side_effect=responses):
            with self.assertRaisesRegex(module.Stop, "pooler_tenant_mismatch"):
                module.endpoint("synthetic-unit-only")

    def test_arbitrary_host_rejected_before_password_use(self):
        responses = [{"id": module.TARGET, "region": module.REGION, "status": "ACTIVE_HEALTHY"},
                     [{"database_type": "PRIMARY", "connection_string": "postgres://postgres." + module.TARGET + "@attacker.invalid:5432/postgres"}]]
        with patch.object(module, "api", side_effect=responses):
            with self.assertRaisesRegex(module.Stop, "pooler_region_hostname_mismatch"):
                module.endpoint("synthetic-unit-only")

    def test_preflight_mode_never_initializes_cli_or_mutates_db(self):
        cfg, env = self.enabled()
        cfg["approvalReceiptSha256"] = "STILL_NO_INSTALL_APPROVAL"
        cfg["readOnlyApprovalReceiptSha256"] = "b" * 64
        env.update({"RELEASE_MODE": "preflight", "INSTALL_ACK": module.READ_ACK,
                    "READ_ONLY_APPROVAL_RECEIPT_SHA256": "b" * 64})
        seven = {r["file"] for r in cfg["orderedSeven"]}
        rows = [{"version": r["file"][:14]} for r in cfg["allSourceMigrations"] if r["file"] not in seven]
        before = {"versions": rows, "tables": 0, "functions": 0}
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory(dir=ROOT) as owned:
            cfg_path = pathlib.Path(owned) / "cfg.json"
            cfg_path.write_text(json.dumps(cfg))
            try:
                os.chdir(owned)
                with patch.dict(module.os.environ, env, clear=True), patch.object(module.sys, "argv", ["proposal", str(cfg_path), owned, str(SCRIPT)]), patch.object(module, "source_gate"), patch.object(module, "ci_gate", side_effect=AssertionError("install gate forbidden")) as ci, patch.object(module.shutil, "which", return_value="/offline/psql"), patch.object(module.pathlib.Path, "is_file", return_value=True), patch.object(module, "endpoint", return_value=("aws-1-ap-northeast-2.pooler.supabase.com", "postgres." + module.TARGET)), patch.object(module, "snapshot", return_value=[before]) as snap, patch.object(module, "command", side_effect=AssertionError("CLI/DB mutation forbidden")) as cli, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(module.main(), 0)
                    ci.assert_not_called()
                    cli.assert_not_called()
                    snap.assert_called_once()
                receipt = json.loads(pathlib.Path("safe-production-install-receipt.json").read_text())
                self.assertTrue(receipt["readOnlyPreflightSuccess"])
                self.assertFalse(receipt["productionSuccess"])
            finally:
                os.chdir(cwd)

    def test_output_limit_stops_owned_child_before_continuation(self):
        # Real local child, synthetic bytes only. No CLI, DB, token, or network.
        with tempfile.TemporaryDirectory(dir=ROOT) as owned:
            continuation = pathlib.Path(owned) / "continued.flag"
            child = "import os,sys,time,pathlib;os.write(1,b'X'*int(sys.argv[2]));time.sleep(1);pathlib.Path(sys.argv[1]).write_text('continued')"
            owned_children = []
            original_spawn = module.subprocess.Popen
            def spawn(*args, **kwargs):
                process = original_spawn(*args, **kwargs)
                owned_children.append(process)
                return process
            with patch.object(module.subprocess, "Popen", side_effect=spawn):
                result = module.command([sys.executable, "-c", child, str(continuation), str(module.LIMIT + 1)], {"PATH": os.environ.get("PATH", "")}, owned, 6)
            self.assertTrue(result["outputLimitExceeded"])
            self.assertFalse(continuation.exists(), "child continued after exceeding output limit")
            self.assertNotEqual(result["exit"], 0)
            self.assertFalse(result["timeout"])
            self.assertEqual(len(owned_children), 1)
            self.assertIsNotNone(owned_children[0].poll())
            self.assertTrue(owned_children[0].stdout.closed)
            self.assertTrue(owned_children[0].stderr.closed)


if __name__ == "__main__":
    unittest.main()
