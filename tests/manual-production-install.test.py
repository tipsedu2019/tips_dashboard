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

    def test_runtime_parser_accepts_only_documented_placeholder_forms(self):
        # Use the actual runtime urllib.parse, including Python 3.12 on the
        # Ubuntu runner. The literal placeholder regressed before connection.
        host = "aws-1-ap-northeast-2.pooler.supabase.com"
        tenant = "postgres." + module.TARGET
        literal = "postgres://" + tenant + ":[YOUR-PASSWORD]@" + host + ":6543/postgres"
        cases = [literal, literal.replace(":[YOUR-PASSWORD]@", ":%5BYOUR-PASSWORD%5D@"),
                 "postgres://" + tenant + "@" + host + ":5432/postgres",
                 "postgresql://" + tenant + ":@" + host + ":5432/postgres"]
        for index, connection in enumerate(cases):
            with self.subTest(case=index):
                responses = [{"id": module.TARGET, "region": module.REGION, "status": "ACTIVE_HEALTHY"},
                             [{"database_type": "PRIMARY", "connection_string": connection}]]
                with patch.object(module, "api", side_effect=responses) as api, patch.object(module, "snapshot", side_effect=AssertionError("DB forbidden")) as snapshot, patch.object(module, "command", side_effect=AssertionError("CLI forbidden")) as cli:
                    self.assertEqual(module.endpoint("synthetic-unit-only"), (host, tenant))
                    self.assertEqual(api.call_args_list[0].args[0], "https://api.supabase.com/v1/projects/" + module.TARGET)
                    self.assertEqual(api.call_args_list[1].args[0], "https://api.supabase.com/v1/projects/" + module.TARGET + "/config/database/pooler")
                    snapshot.assert_not_called()
                    cli.assert_not_called()

    def test_placeholder_normalization_preserves_destination_and_secret_boundaries(self):
        host = "aws-1-ap-northeast-2.pooler.supabase.com"
        tenant = "postgres." + module.TARGET
        literal = "postgres://" + tenant + ":[YOUR-PASSWORD]@" + host + ":6543/postgres"
        cases = [
            (literal.replace(host, "attacker.invalid"), "pooler_region_hostname_mismatch"),
            (literal.replace("ap-northeast-2", "us-east-1"), "pooler_region_hostname_mismatch"),
            (literal.replace(tenant, "postgres.wrong"), "pooler_tenant_mismatch"),
            (literal.replace("/postgres", "/other"), "pooler_tenant_mismatch"),
            (literal + "?sslmode=disable", "pooler_options_requires_review"),
            (literal + "#fragment", "pooler_options_requires_review"),
            (literal.replace("[YOUR-PASSWORD]", "synthetic-unexpected-password"), "pooler_password_must_not_be_received"),
            (literal.replace("[YOUR-PASSWORD]", "%255BYOUR-PASSWORD%255D"), "pooler_password_must_not_be_received"),
            (literal.replace("[YOUR-PASSWORD]", "%5bYOUR-PASSWORD%5d"), "pooler_password_must_not_be_received"),
            (literal.replace(":6543/", ":1234/"), "pooler_port_unexpected"),
            (literal.replace(":6543/", ":not-a-port/"), "pooler_url_parse_failed"),
            (literal.replace(":6543/", ":99999/"), "pooler_url_parse_failed"),
            (literal.replace("[YOUR-PASSWORD]", "[BROKEN"), "pooler_url_parse_failed"),
            (" " + literal, "pooler_connection_string_shape_invalid"),
            (literal + "\n", "pooler_connection_string_shape_invalid"),
            (literal.replace("postgres://", "https://"), "pooler_scheme_invalid"),
            (literal.replace(host, host + ".evil.invalid"), "pooler_region_hostname_mismatch"),
        ]
        for index, (connection, expected) in enumerate(cases):
            with self.subTest(case=index):
                responses = [{"id": module.TARGET, "region": module.REGION, "status": "ACTIVE_HEALTHY"},
                             [{"database_type": "PRIMARY", "connection_string": connection}]]
                with patch.object(module, "api", side_effect=responses), patch.object(module, "snapshot", side_effect=AssertionError("DB forbidden")) as snapshot, patch.object(module, "command", side_effect=AssertionError("CLI forbidden")) as cli:
                    with self.assertRaises(module.Stop) as caught:
                        module.endpoint("synthetic-unit-only")
                    self.assertEqual(str(caught.exception), expected)
                    snapshot.assert_not_called()
                    cli.assert_not_called()

    def test_provider_shape_failures_return_bounded_codes(self):
        project = {"id": module.TARGET, "region": module.REGION, "status": "ACTIVE_HEALTHY"}
        primary = {"database_type": "PRIMARY", "connection_string": "postgres://postgres." + module.TARGET + ":[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"}
        cases = [
            ([[], [primary]], "project_metadata_shape_invalid"),
            ([project, {}], "pooler_metadata_shape_invalid"),
            ([project, ["not-a-dict"]], "pooler_metadata_shape_invalid"),
            ([project, [{"database_type": "PRIMARY"}]], "pooler_connection_string_shape_invalid"),
            ([project, [{"database_type": "PRIMARY", "connection_string": None}]], "pooler_connection_string_shape_invalid"),
            ([project, [{"database_type": "PRIMARY", "connection_string": 123}]], "pooler_connection_string_shape_invalid"),
            ([project, [{"database_type": "PRIMARY", "connection_string": "x" * 4097}]], "pooler_connection_string_shape_invalid"),
            ([project, [{"database_type": "PRIMARY", "connection_string": primary["connection_string"].replace("postgres://", "postgr\u00e9s://")}]], "pooler_connection_string_shape_invalid"),
            ([project, [primary, primary]], "primary_pooler_ambiguous"),
        ]
        for index, (responses, expected) in enumerate(cases):
            with self.subTest(case=index):
                with patch.object(module, "api", side_effect=responses), patch.object(module, "snapshot", side_effect=AssertionError("DB forbidden")) as snapshot, patch.object(module, "command", side_effect=AssertionError("CLI forbidden")) as cli:
                    with self.assertRaises(module.Stop) as caught:
                        module.endpoint("synthetic-unit-only")
                    self.assertEqual(str(caught.exception), expected)
                    snapshot.assert_not_called()
                    cli.assert_not_called()

    def test_parse_failure_receipt_is_redacted_and_stops_before_connection(self):
        cfg, env = self.enabled()
        cfg["readOnlyApprovalReceiptSha256"] = "b" * 64
        env.update({"RELEASE_MODE": "preflight", "INSTALL_ACK": module.READ_ACK,
                    "READ_ONLY_APPROVAL_RECEIPT_SHA256": "b" * 64})
        marker = "synthetic-provider-detail-must-not-escape"
        responses = [{"id": module.TARGET, "region": module.REGION, "status": "ACTIVE_HEALTHY"},
                     [{"database_type": "PRIMARY", "connection_string": "postgres://postgres." + module.TARGET + ":[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:" + marker + "/postgres"}]]
        cwd = os.getcwd()
        fixtures = ROOT / ".codex-artifacts"
        fixtures.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=fixtures) as owned:
            cfg_path = pathlib.Path(owned) / "cfg.json"
            cfg_path.write_text(json.dumps(cfg))
            captured = io.StringIO()
            try:
                os.chdir(owned)
                with patch.dict(module.os.environ, env, clear=True), patch.object(module.sys, "argv", ["offline", str(cfg_path), owned, str(SCRIPT)]), patch.object(module, "source_gate"), patch.object(module.shutil, "which", return_value="/offline/psql"), patch.object(module.pathlib.Path, "is_file", return_value=True), patch.object(module, "api", side_effect=responses), patch.object(module, "snapshot", side_effect=AssertionError("DB forbidden")) as snapshot, patch.object(module, "command", side_effect=AssertionError("CLI forbidden")) as cli, contextlib.redirect_stdout(captured):
                    self.assertEqual(module.main(), 1)
                    snapshot.assert_not_called()
                    cli.assert_not_called()
                receipt_text = pathlib.Path("safe-production-install-receipt.json").read_text()
                receipt = json.loads(receipt_text)
                self.assertEqual(receipt["failure"], "pooler_url_parse_failed")
                self.assertFalse(receipt["productionSuccess"])
                self.assertFalse(receipt["automaticRetry"])
                self.assertNotIn(marker, receipt_text + captured.getvalue())
                self.assertNotIn("[YOUR-PASSWORD]", receipt_text + captured.getvalue())
            finally:
                os.chdir(cwd)

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


    def test_snapshot_failure_classifier_only_returns_bounded_unambiguous_codes(self):
        cases = [
            ("FATAL: password authentication failed for user synthetic", "read_only_snapshot_authentication_failed"),
            ("fe_sendauth: no password supplied", "read_only_snapshot_authentication_failed"),
            ("SASL authentication failed", "read_only_snapshot_authentication_failed"),
            ("SSL error: certificate verify failed", "read_only_snapshot_tls_verification_failed"),
            ("server certificate does not match host name synthetic", "read_only_snapshot_tls_verification_failed"),
            ("could not translate host name synthetic", "read_only_snapshot_network_failed"),
            ("Temporary failure in name resolution", "read_only_snapshot_network_failed"),
            ("connection refused", "read_only_snapshot_network_failed"),
            ("network is unreachable", "read_only_snapshot_network_failed"),
            ("no route to host", "read_only_snapshot_network_failed"),
            ("connection timed out", "read_only_snapshot_network_failed"),
            ("timeout expired", "read_only_snapshot_network_failed"),
            ("SSL private key: no password supplied", "read_only_snapshot_failed"),
            ("SSL connection has been closed unexpectedly", "read_only_snapshot_failed"),
            ("authentication mechanism unavailable", "read_only_snapshot_failed"),
            ("provider detail ERROR: 42501", "read_only_snapshot_failed"),
            ("ERROR: A1B2C", "read_only_snapshot_failed"),
            ("ERROR: 42501: provider detail", "read_only_snapshot_failed"),
            ("ERROR: 42501X", "read_only_snapshot_failed"),
            ("ERROR: 42501\nERROR: 42P01", "read_only_snapshot_failed"),
            ("password authentication failed\ncertificate verify failed", "read_only_snapshot_failed"),
            ("provider detail", "read_only_snapshot_failed"),
        ]
        states = ("42501", "42P01", "42703", "42883", "42601", "42804", "57014", "55P03")
        for state in states:
            cases.append(("ERROR:  " + state + "\n", "read_only_snapshot_sqlstate_" + state))
        cases.extend([
            ("psql:<stdin>:3: ERROR:  42501\n", "read_only_snapshot_sqlstate_42501"),
            ("psql: error: FATAL:  42P01\n", "read_only_snapshot_sqlstate_42P01"),
        ])
        for index, (stderr, expected) in enumerate(cases):
            with self.subTest(case=index):
                self.assertEqual(module.snapshot_failure_code(stderr), expected)

    def test_snapshot_failures_keep_provider_details_out_of_main_receipt_and_output(self):
        marker = "synthetic-secret-sentinel-do-not-persist"
        provider = "https://synthetic-provider.invalid/path?token=" + marker
        host = "synthetic-session-host.invalid"
        user = "synthetic-session-user"
        tail = "\n" + marker + " " + provider + " " + host + " " + user + "\n"
        cases = [
            ("FATAL: password authentication failed for user " + user, "read_only_snapshot_authentication_failed"),
            ("SSL error: certificate verify failed", "read_only_snapshot_tls_verification_failed"),
            ("could not translate host name " + host + ": Name or service not known", "read_only_snapshot_network_failed"),
            ("connection refused", "read_only_snapshot_network_failed"),
            ("provider detail", "read_only_snapshot_failed"),
            ("SSL private key: no password supplied", "read_only_snapshot_failed"),
            ("SSL connection has been closed unexpectedly", "read_only_snapshot_failed"),
            ("provider detail ERROR: 42501", "read_only_snapshot_failed"),
            ("ERROR: A1B2C", "read_only_snapshot_failed"),
            ("ERROR: 42501: provider detail", "read_only_snapshot_failed"),
            ("password authentication failed\ncertificate verify failed", "read_only_snapshot_failed"),
            ("ERROR: 42501\nERROR: 42P01", "read_only_snapshot_failed"),
        ]
        for state in ("42501", "42P01", "42703", "42883", "42601", "42804", "57014", "55P03"):
            cases.append(("ERROR:  " + state, "read_only_snapshot_sqlstate_" + state))
        outcomes = [(module.subprocess.CompletedProcess(["psql"], 1, "", stderr + tail), expected) for stderr, expected in cases]
        outcomes.extend([
            (module.subprocess.CompletedProcess(["psql"], 0, "{" + marker, tail), "read_only_snapshot_invalid_json"),
            (module.subprocess.CompletedProcess(["psql"], 0, "X" * (module.LIMIT + 1) + marker, tail), "read_only_snapshot_output_limit"),
            (module.subprocess.CompletedProcess(["psql"], 1, "", "X" * (module.LIMIT + 1) + tail), "read_only_snapshot_output_limit"),
            (module.subprocess.TimeoutExpired(["psql", marker], 30, output=marker.encode(), stderr=tail.encode()), "read_only_snapshot_timeout"),
        ])
        fixtures = ROOT / ".codex-artifacts"
        fixtures.mkdir(exist_ok=True)
        for index, (outcome, expected) in enumerate(outcomes):
            with self.subTest(case=index):
                cfg, env = self.enabled()
                cfg["readOnlyApprovalReceiptSha256"] = "b" * 64
                env.update({"RELEASE_MODE": "preflight", "INSTALL_ACK": module.READ_ACK,
                            "READ_ONLY_APPROVAL_RECEIPT_SHA256": "b" * 64,
                            "SUPABASE_DB_PASSWORD": marker})
                cwd = os.getcwd()
                with tempfile.TemporaryDirectory(dir=fixtures) as owned:
                    cfg_path = pathlib.Path(owned) / "cfg.json"
                    cfg_path.write_text(json.dumps(cfg))
                    captured, captured_error = io.StringIO(), io.StringIO()
                    process = patch.object(module.subprocess, "run", side_effect=outcome) if isinstance(outcome, module.subprocess.TimeoutExpired) else patch.object(module.subprocess, "run", return_value=outcome)
                    try:
                        os.chdir(owned)
                        with patch.dict(module.os.environ, env, clear=True), patch.object(module.sys, "argv", ["offline", str(cfg_path), owned, str(SCRIPT)]), patch.object(module, "source_gate"), patch.object(module.shutil, "which", return_value="/offline/psql"), patch.object(module.pathlib.Path, "is_file", return_value=True), patch.object(module, "endpoint", return_value=(host, user)), patch.object(module, "api", side_effect=AssertionError("network forbidden")) as api, process as psql, patch.object(module, "command", side_effect=AssertionError("CLI forbidden")) as cli, contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured_error):
                            self.assertEqual(module.main(), 1)
                            psql.assert_called_once()
                            api.assert_not_called()
                            cli.assert_not_called()
                        receipt_text = pathlib.Path("safe-production-install-receipt.json").read_text()
                        receipt = json.loads(receipt_text)
                        self.assertEqual(receipt["failure"], expected)
                        self.assertFalse(receipt["productionSuccess"])
                        self.assertFalse(receipt["automaticRetry"])
                        self.assertNotIn("before", receipt)
                        output = receipt_text + captured.getvalue() + captured_error.getvalue()
                        for forbidden in (marker, provider, host, user):
                            self.assertNotIn(forbidden, output)
                    finally:
                        os.chdir(cwd)

    def test_snapshot_keeps_verified_read_only_session_and_original_psql_boundary(self):
        record = {"user": "postgres", "readOnly": "on", "tls": True}
        result = module.subprocess.CompletedProcess(["psql"], 0, json.dumps(record) + "\n", "")
        with patch.object(module.subprocess, "run", return_value=result) as psql:
            self.assertEqual(module.snapshot(CFG, "synthetic-host.invalid", "synthetic-user", "synthetic-password"), [record])
        args, kwargs = psql.call_args
        self.assertEqual(args[0], ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"])
        self.assertEqual(kwargs["env"]["PGSSLMODE"], "verify-full")
        self.assertEqual(kwargs["env"]["PGSSLROOTCERT"], module.CA)
        self.assertEqual(kwargs["env"]["PGPORT"], "5432")
        self.assertEqual(kwargs["timeout"], 30)
        self.assertTrue(kwargs["input"].startswith("\\set VERBOSITY sqlstate\nBEGIN; SET TRANSACTION READ ONLY;"))
        self.assertTrue(kwargs["input"].endswith("ROLLBACK;\n"))
        insecure = module.subprocess.CompletedProcess(["psql"], 0, json.dumps({**record, "tls": False}) + "\n", "")
        with patch.object(module.subprocess, "run", return_value=insecure):
            with self.assertRaisesRegex(module.Stop, "snapshot_session_boundary_failed"):
                module.snapshot(CFG, "synthetic-host.invalid", "synthetic-user", "synthetic-password")


if __name__ == "__main__":
    unittest.main()
