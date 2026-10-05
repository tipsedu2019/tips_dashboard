"""Prepared offline safety suite for the inactive PR97 runner draft.

Preparing this file does not execute or import the draft. An explicit offline test
run imports it with network/process creation forbidden; production APIs, psql,
and the Supabase CLI stay mocked throughout. Synthetic values are never secrets.
Only synthetic negative scenarios enable the stale-source blocker. Product
approval, API/database access, and real CLI execution stay outside this suite.
"""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/manual-inheritance-hotfix-install.py"
MANIFEST = ROOT / "scripts/inheritance-hotfix-release-manifest.json"
SOURCE = "1eccff3254b7024dc242bcffd11eb4505ff0700c"
SQL_SHA256 = "ca71cf8edc2135723c1a8e527ddbed5c285f6fb72da7a084966d8914597a9eb3"
MIGRATION = "20261004160000_legacy_effective_schedule_inheritance.sql"
NOW = 1_800_000_000
PAUSE_ACK = "AFFECTED PR97 WRITERS AND OTHER DDL INSTALLERS PAUSED"
EXPECTED_QUIESCENCE = {
    "readOnlyPreflightRequiresPause": False,
    "requiredForInstall": [
        "other_production_ddl_and_migration_installers",
        "class_schedule_defaults_lessons_slots_teacher_room_and_roster_enrollment_writers",
        "makeup_approval_cancellation_and_lifecycle_writers",
        "human_and_bot_calls_using_replaced_schedule_readers_including_get_class_schedule_v1_runtime_materialization",
        "calendar_academic_event_and_makeup_approval_evidence_writers_altering_inherited_schedule_or_occupancy_provenance",
    ],
    "affectedInFlightTransactionsMustBeDrained": True,
    "unrelatedRetentionAndNotificationJournalWritersRequirePause": False,
    "resumeOnlyAfter": "verified_post_install_checkpoint_or_explicit_unknown_state_diagnosis",
    "pauseAck": PAUSE_ACK,
    "pauseAttestationMaxAgeSeconds": 300,
}

# These are source-segment hashes from independently reviewed helper source
# SHA256 31bf00adb87f7ac07a3379ae58859eef16f756aa3a9fc50b967add288a727667.
# No held AI checkout is needed or imported when this suite eventually runs.
REVIEWED_HELPERS = {
    "Stop": "658138aef0732e3fc33561d89237ace08b5a6704513a52a7b6cd6669e0ff7449",
    "require": "b957e8219ba087b45e24a25eaec80e17000cdcc7b58a13a5116d8aac192e3598",
    "ca_gate": "d8421261f8b6fd7c0b0438fad9c2e2104255200eda04ee5d544b437d36908038",
    "digest_versions": "56e9d01a6bc02354270a08738d5e3e5bee25541c4464eace3dac50ec67c7284e",
    "api": "a290b6b5df7cef27573f52094a16be5cfc12a603b1842dd145a2ea1647410942",
    "ci_gate": "9a89bb9e2bb2aebabf265b58b6e75e53e681e1a694e90d307f194b546378cef1",
    "endpoint": "96a1fe5b07c828d4190407b3c607cd253ab8d492ec3324f6efdc6bf67d09a443",
    "command": "0e652be14b47c478fbdf2dee2443439d8c296543f7a04c10312b8c448e608b03",
    "quote": "27a962c0ad2abf3c18759057990b4eb831cf577821eaf39e8dfcf608e64d8a39",
    "snapshot_failure_code": "079b6c58cef28b9de747e7e3de646f0acc97373a4a45c4c14767491466f453f8",
}


def forbidden(*_args, **_kwargs):
    raise AssertionError("offline test attempted a real external operation")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


class OfflineInheritanceSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # This happens only during a future test execution, never preparation.
        cls.source_text = SCRIPT.read_text()
        cls.source_ast = ast.parse(cls.source_text)
        spec = importlib.util.spec_from_file_location("inactive_inheritance_draft_test", SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        with contextlib.ExitStack() as guards:
            guards.enter_context(patch("subprocess.Popen", side_effect=forbidden))
            guards.enter_context(patch("subprocess.run", side_effect=forbidden))
            guards.enter_context(patch("subprocess.check_output", side_effect=forbidden))
            guards.enter_context(patch("urllib.request.urlopen", side_effect=forbidden))
            spec.loader.exec_module(cls.module)
        cls.envelope = json.loads(MANIFEST.read_text())
        cls.contract = cls.envelope["contract"]

    def setUp(self):
        self.snapshot_impl = self.module.snapshot
        self.guards = contextlib.ExitStack()
        self.addCleanup(self.guards.close)
        # Exercise the reviewed contract only in synthetic scenarios. Dedicated
        # negative tests restore the global stale-source regression blocker.
        self.guards.enter_context(patch.object(self.module, "STALE_SOURCE", False))
        self.guards.enter_context(patch("urllib.request.urlopen", side_effect=forbidden))
        self.guards.enter_context(patch.object(self.module.subprocess, "Popen", side_effect=forbidden))
        self.guards.enter_context(patch.object(self.module.subprocess, "run", side_effect=forbidden))
        self.guards.enter_context(patch.object(self.module.subprocess, "check_output", side_effect=forbidden))
        self.guards.enter_context(patch.object(self.module, "api", side_effect=forbidden))
        self.guards.enter_context(patch.object(self.module, "command", side_effect=forbidden))
        self.guards.enter_context(patch.object(self.module, "snapshot", side_effect=forbidden))

    def authority_fixture(self, changes=None):
        cfg = copy.deepcopy(self.contract)
        now = NOW
        authority = {
            "approvalKind": "owner_action_time_inheritance_hotfix",
            "sourceSha": SOURCE, "sqlSha256": SQL_SHA256,
            "projectRef": self.module.TARGET, "region": self.module.REGION,
            "unsignedContractSha256": self.module.CONTRACT_SHA256,
            "scriptSha256": hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
            "caSha256": self.module.CA_SHA256,
            "newPermissions": cfg["newPermissions"], "before": cfg["before"], "after": cfg["after"],
            "allowedModes": ["preflight", "install"], "maxInstallDispatches": 1,
            "installationQuiescence": copy.deepcopy(EXPECTED_QUIESCENCE),
            "noAutomaticRetryRepairOrRollback": True,
            "approvedAtEpoch": now - 30, "expiresAtEpoch": now + 60,
        }
        authority.update(changes or {})
        raw = canonical(authority)
        receipt_hash = hashlib.sha256(raw).hexdigest()
        cfg["approvalReceiptSha256"] = receipt_hash
        env = {
            "OWNER_APPROVAL_RECEIPT_SHA256": receipt_hash,
            "GITHUB_REPOSITORY": "tipsedu2019/tips_dashboard",
            "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main",
            "GITHUB_RUN_ATTEMPT": "1", "INSTALL_ACK": self.module.READ_ACK,
            "SUPABASE_DB_PASSWORD": "synthetic-unit-only",
            "SUPABASE_ACCESS_TOKEN": "synthetic-unit-only", "GH_TOKEN": "synthetic-unit-only",
        }
        return cfg, env, authority, raw, now

    def install_env(self, env, epoch=NOW):
        return {**env, "RELEASE_MODE": "install", "INSTALL_ACK": self.module.ACK,
                "INSTALL_PAUSE_ACK": PAUSE_ACK, "INSTALL_PAUSE_AT_EPOCH": str(epoch)}

    def snapshot_fixture(self):
        # Historical production ledger names are deliberately not copied here.
        # Keep the exact real version set and use source-derived synthetic names
        # with fixture-only name digests for pure verifier behavior.
        cfg = copy.deepcopy(self.contract)
        rows = [{"version": row["version"], "name": row["name"]}
                for row in cfg["allSourceMigrations"]]
        cfg["before"]["versionNamesCanonicalJsonSha256"] = hashlib.sha256(canonical(rows[:-1])).hexdigest()
        cfg["after"]["versionNamesCanonicalJsonSha256"] = hashlib.sha256(canonical(rows)).hexdigest()
        session = {"user": "postgres", "database": "postgres", "readOnly": "on", "serverMajor": 17, "tls": True}
        before = {**session, "versions": rows[:-1], "functions": copy.deepcopy(cfg["beforeCatalog"])}
        after = {**session, "versions": rows, "functions": copy.deepcopy(cfg["afterCatalog"])}
        return cfg, before, after

    @contextlib.contextmanager
    def source_fixture(self):
        with tempfile.TemporaryDirectory(prefix="inheritance-offline-") as owned:
            source = pathlib.Path(owned)
            migrations = source / "supabase/migrations"
            migrations.mkdir(parents=True)
            cfg = copy.deepcopy(self.contract)
            synthetic = b"-- synthetic offline fixture; never executed\n"
            for row in cfg["allSourceMigrations"]:
                (migrations / row["file"]).write_bytes(synthetic)
                row["sha256"] = hashlib.sha256(synthetic).hexdigest()
            (source / "supabase/config.toml").write_text('project_id = "' + self.module.TARGET + '"\n')
            def git_result(argv, **_kwargs):
                if argv == ["git", "rev-parse", "HEAD"]:
                    return types.SimpleNamespace(returncode=0, stdout=SOURCE + "\n", stderr="")
                if argv == ["git", "status", "--porcelain", "--untracked-files=all"]:
                    return types.SimpleNamespace(returncode=0, stdout="", stderr="")
                raise AssertionError("unexpected offline git operation")
            with patch.object(self.module.subprocess, "run", side_effect=git_result):
                yield source, cfg

    def test_transport_and_ca_helpers_keep_reviewed_source_exactly(self):
        actual = {
            node.name: hashlib.sha256(ast.get_source_segment(self.source_text, node).encode()).hexdigest()
            for node in self.source_ast.body
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in REVIEWED_HELPERS
        }
        self.assertEqual(actual, REVIEWED_HELPERS)

    def test_contract_is_only_the_reviewed_single_migration(self):
        cfg = self.contract
        self.assertEqual(cfg["approvedSourceSha"], SOURCE)
        self.assertEqual(cfg["onlyMigration"], {
            "file": MIGRATION, "version": "20261004160000",
            "name": "legacy_effective_schedule_inheritance", "sha256": SQL_SHA256,
        })
        self.assertEqual(len(cfg["allSourceMigrations"]), 363)
        self.assertEqual(cfg["before"]["count"], 362)
        self.assertEqual(cfg["before"]["latest"], "20261002170849")
        self.assertEqual(cfg["before"]["versionsSha256"], "63d5517028ceb647b242b24edba0957fd6ce010fb3abc762a6dfef363733f93b")
        self.assertEqual(cfg["after"]["count"], 363)
        self.assertEqual(cfg["after"]["latest"], "20261004160000")
        self.assertEqual(cfg["after"]["versionsSha256"], "1edeca0dfb3d8a32c4f29b4c467d30ca25ba8ce77cee1a8ab62ee5e8d841def3")
        versions = [row["version"] for row in cfg["allSourceMigrations"]]
        self.assertEqual(versions, sorted(set(versions)))
        self.assertTrue(set(cfg["excluded"]["versions"]).isdisjoint(versions))
        self.assertEqual(cfg["excluded"]["versions"], ["20261004140438", "20261004140440"])
        self.assertTrue(cfg["singleInstallDispatch"])
        self.assertTrue(cfg["noAutomaticRetryRepairOrRollback"])
        self.assertEqual(len(cfg["afterCatalog"]), 14)
        before = {row["signature"]: row for row in cfg["beforeCatalog"]}
        after = {row["signature"]: row for row in cfg["afterCatalog"]}
        self.assertEqual(set(before), set(after))
        self.assertEqual(sum(not row["exists"] for row in before.values()), 9)
        self.assertTrue(all(row["exists"] for row in after.values()))
        writer = "dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)"
        replaced_declarations = {
            "dashboard_private.read_timetable_operating_reference_v1()",
            "public.get_class_schedule_v1(uuid,date,date)",
            "public.get_makeup_approval_collision_context_v1(jsonb)",
            "public.get_makeup_reservation_context_v1(jsonb,uuid[])",
        }
        self.assertEqual({signature for signature, row in before.items() if row["exists"] and signature != writer}, replaced_declarations)
        self.assertEqual(len(set(after) - {writer}), 13)  # Nine new plus four replaced declarations.
        unchanged_public_rpcs = {
            "public.get_makeup_approval_collision_context_v1(jsonb)",
            "public.get_makeup_reservation_context_v1(jsonb,uuid[])",
        }
        # Re-declaration does not imply a body/ACL change. The bounded effective
        # occupancy data now has its own RPC; these existing consumers stay exact.
        changed = {signature for signature in before if before[signature] != after[signature]}
        self.assertEqual(len(changed), 11)
        self.assertEqual(changed, set(after) - {writer} - unchanged_public_rpcs)
        for signature in unchanged_public_rpcs:
            self.assertEqual(before[signature], after[signature])
        self.assertEqual(before[writer], after[writer])

    def test_contract_hash_is_independent_of_activation_envelope(self):
        self.assertEqual(hashlib.sha256(canonical(self.contract)).hexdigest(), self.module.CONTRACT_SHA256)
        activated = copy.deepcopy(self.envelope)
        activated["proposalOnly"] = False
        activated["sourceReviewStatus"] = "reviewed_current"
        activated["approvalReceiptSha256"] = "a" * 64
        self.assertEqual(hashlib.sha256(canonical(activated["contract"])).hexdigest(), self.module.CONTRACT_SHA256)
        calls = []
        def synthetic_manifest(path):
            if path != self.module.MANIFEST:
                raise AssertionError("synthetic activation attempted real owner authority access")
            calls.append(path)
            return activated, canonical(activated)
        with patch.object(self.module, "bounded_json", side_effect=synthetic_manifest), patch.object(self.module, "approval_gate", side_effect=forbidden) as authority:
            loaded = self.module.load_contract()
            authority.assert_not_called()
        self.assertEqual(calls, [self.module.MANIFEST])
        self.assertEqual(loaded, {**self.contract, "approvalReceiptSha256": "a" * 64})

    def test_contract_binds_affected_writer_scope_without_asserting_a_current_pause(self):
        self.assertEqual(self.contract["installationQuiescence"], EXPECTED_QUIESCENCE)
        self.assertNotIn("requiresOtherDatabaseWritersPaused", self.contract)
        _, env, authority, _, _ = self.authority_fixture()
        self.assertEqual(authority["installationQuiescence"], EXPECTED_QUIESCENCE)
        self.assertNotIn("otherDatabaseWritersPausedForInstall", authority)
        self.assertNotIn("INSTALL_PAUSE_ACK", env)
        self.assertNotIn("INSTALL_PAUSE_AT_EPOCH", env)

    def test_new_execution_permissions_require_specific_owner_review(self):
        catalog = {row["signature"]: row for row in self.contract["afterCatalog"]}
        permissions = self.contract["newPermissions"]
        self.assertIsInstance(permissions, list)
        self.assertEqual({permission["signature"] for permission in permissions}, {
            "dashboard_private.read_makeup_operating_reference_v1(date,date)",
            "dashboard_private.makeup_effective_class_context_v1(jsonb)",
            "public.get_makeup_effective_occupancy_v1(jsonb)",
        })
        self.assertEqual(len({permission["signature"] for permission in permissions}), len(permissions))
        for permission in permissions:
            with self.subTest(signature=permission["signature"]):
                row = catalog[permission["signature"]]
                self.assertEqual(row["securityDefiner"], permission["securityDefiner"])
                self.assertEqual(row["owner"], permission["owner"])
                self.assertEqual(row["returns"], permission["returns"])
                self.assertFalse(row["anonExecute"])
                self.assertEqual(row["authenticatedExecute"], "authenticated" in permission["grantees"])
                self.assertEqual(row["serviceRoleExecute"], "service_role" in permission["grantees"])

    def test_occupancy_approval_binds_date_response_bounds_and_unproven_work_budget(self):
        permissions = {permission["signature"]: permission for permission in self.contract["newPermissions"]}
        adapter = permissions["dashboard_private.read_makeup_operating_reference_v1(date,date)"]
        self.assertEqual(adapter["grantees"], [])
        self.assertTrue(adapter["securityDefiner"])
        self.assertIn("14 inclusive KST days", adapter["guard"])
        expected_bounds = {
            "maxDayEnvelopes": 14, "maxInclusiveKstDays": 14,
            "maxFinalOccupancyRows": 2000, "overflowSqlstate": "22023",
            "overflowMessage": "makeup_effective_capacity_exceeded",
            "executionWorkBudgetEstablished": False, "productionLatencyProven": False,
            "databaseCancellationProven": False, "multipleBatchesSingleSnapshot": False,
        }
        expected_keys = ["id", "classId", "className", "date", "startMinute", "endMinute", "classroom", "uncertain", "allRooms"]
        for signature in ("dashboard_private.makeup_effective_class_context_v1(jsonb)", "public.get_makeup_effective_occupancy_v1(jsonb)"):
            with self.subTest(signature=signature):
                permission = permissions[signature]
                self.assertEqual(permission["grantees"], ["authenticated", "service_role"])
                self.assertEqual(permission["resourceBounds"], expected_bounds)
                self.assertEqual(permission["dtoKeys"], expected_keys)
        self.assertTrue(permissions["dashboard_private.makeup_effective_class_context_v1(jsonb)"]["securityDefiner"])
        self.assertFalse(permissions["public.get_makeup_effective_occupancy_v1(jsonb)"]["securityDefiner"])

    def test_inactive_proposal_stops_before_owner_receipt_or_credentials(self):
        proposal = copy.deepcopy(self.envelope)
        proposal["proposalOnly"] = True
        proposal["approvalReceiptSha256"] = None
        calls = []
        def public_document(path):
            calls.append(path)
            if path != self.module.MANIFEST:
                raise AssertionError("proposal attempted owner authority access")
            return proposal, canonical(proposal)
        with patch.object(self.module, "bounded_json", side_effect=public_document):
            with self.assertRaisesRegex(self.module.Stop, "^proposal_not_activated$"):
                self.module.load_contract()
        self.assertEqual(calls, [self.module.MANIFEST])

    def test_stale_source_blocks_before_manifest_or_owner_receipt(self):
        with patch.object(self.module, "STALE_SOURCE", True), patch.object(self.module, "bounded_json", side_effect=forbidden) as public_document, patch.object(self.module, "approval_gate", side_effect=forbidden) as authority:
            with self.assertRaisesRegex(self.module.Stop, "^stale_product_source_replacement_required$"):
                self.module.load_contract()
            public_document.assert_not_called()
            authority.assert_not_called()

    def test_stale_main_stops_before_credentials_helpers_or_transport(self):
        captured = io.StringIO()
        marker = "synthetic-stale-secret-must-not-escape"
        with tempfile.TemporaryDirectory(prefix="inheritance-stale-offline-") as owned:
            receipt_path = pathlib.Path(owned) / "receipt.json"
            with patch.object(self.module, "STALE_SOURCE", True), patch.object(self.module, "bounded_json", side_effect=forbidden) as public_document, patch.object(self.module, "SAFE_RECEIPT", str(receipt_path)), patch.object(self.module.sys, "argv", ["offline"]), patch.dict(self.module.os.environ, {"SUPABASE_DB_PASSWORD": marker, "SUPABASE_ACCESS_TOKEN": marker, "GH_TOKEN": marker}, clear=True), patch.object(self.module, "approval_gate", side_effect=forbidden) as authority, patch.object(self.module, "source_gate", side_effect=forbidden) as source, patch.object(self.module, "ca_gate", side_effect=forbidden) as ca, patch.object(self.module, "ci_gate", side_effect=forbidden) as ci, patch.object(self.module, "endpoint", side_effect=forbidden) as endpoint, patch.object(self.module, "install_once", side_effect=forbidden) as install, contextlib.redirect_stdout(captured):
                self.assertEqual(self.module.main(), 1)
                for unused in (public_document, authority, source, ca, ci, endpoint, install):
                    unused.assert_not_called()
            receipt_text = receipt_path.read_text()
            receipt = json.loads(receipt_text)
            self.assertEqual(receipt["failure"], "stale_product_source_replacement_required")
            self.assertFalse(receipt["productionSuccess"])
            self.assertFalse(receipt["automaticRetry"])
            self.assertFalse(receipt["historyRepair"])
            self.assertNotIn(marker, receipt_text + captured.getvalue())

    def test_source_review_status_blocks_before_contract_or_authority(self):
        envelope = copy.deepcopy(self.envelope)
        envelope["proposalOnly"] = False
        envelope["sourceReviewStatus"] = "stale_replacement_required"
        # A modified contract would fail its digest only after the current-source
        # review status. This proves the independent review gate's ordering.
        envelope["contract"]["approvedSourceSha"] = "a" * 40
        with patch.object(self.module, "bounded_json", return_value=(envelope, canonical(envelope))), patch.object(self.module, "approval_gate", side_effect=forbidden) as authority:
            with self.assertRaisesRegex(self.module.Stop, "^product_source_review_incomplete$"):
                self.module.load_contract()
            authority.assert_not_called()

    def test_main_proposal_receipt_is_safe_and_stops_before_helpers(self):
        proposal = copy.deepcopy(self.envelope)
        proposal["proposalOnly"] = True
        proposal["approvalReceiptSha256"] = None
        captured = io.StringIO()
        with tempfile.TemporaryDirectory(prefix="inheritance-receipt-offline-") as owned:
            receipt_path = pathlib.Path(owned) / "receipt.json"
            with patch.object(self.module, "bounded_json", return_value=(proposal, canonical(proposal))), patch.object(self.module, "SAFE_RECEIPT", str(receipt_path)), patch.object(self.module.sys, "argv", ["offline"]), patch.dict(self.module.os.environ, {}, clear=True), patch.object(self.module, "approval_gate", side_effect=forbidden) as approval, patch.object(self.module, "source_gate", side_effect=forbidden) as source, patch.object(self.module, "ca_gate", side_effect=forbidden) as ca, contextlib.redirect_stdout(captured):
                self.assertEqual(self.module.main(), 1)
                approval.assert_not_called()
                source.assert_not_called()
                ca.assert_not_called()
            receipt = json.loads(receipt_path.read_text())
            self.assertEqual(receipt["failure"], "proposal_not_activated")
            self.assertFalse(receipt["productionSuccess"])
            self.assertFalse(receipt["automaticRetry"])
            self.assertFalse(receipt["historyRepair"])

    def test_activation_does_not_allow_unsigned_contract_changes(self):
        for field, replacement in [("approvedSourceSha", "a" * 40), ("target", {"projectRef": "wrong"}), ("before", {"count": 369}), ("onlyMigration", {"file": "other.sql"})]:
            with self.subTest(field=field):
                envelope = copy.deepcopy(self.envelope)
                envelope["proposalOnly"] = False
                envelope["sourceReviewStatus"] = "reviewed_current"
                envelope["contract"][field] = replacement
                with patch.object(self.module, "bounded_json", return_value=(envelope, canonical(envelope))):
                    with self.assertRaisesRegex(self.module.Stop, "^unsigned_contract_mismatch$"):
                        self.module.load_contract()

    def test_pending_owner_authority_stops_before_receipt_access(self):
        cfg = copy.deepcopy(self.contract)
        cfg["approvalReceiptSha256"] = None
        with patch.object(self.module, "bounded_json", side_effect=forbidden) as read:
            with self.assertRaisesRegex(self.module.Stop, "^owner_authority_pending$"):
                self.module.approval_gate(cfg, {}, credentials=False)
            read.assert_not_called()

    def test_authority_is_bound_to_specific_permission_source_and_single_dispatch(self):
        changes = [
            {"approvalKind": "ai_install_owner_approval"}, {"sourceSha": "a" * 40},
            {"sqlSha256": "a" * 64}, {"scriptSha256": "a" * 64},
            {"unsignedContractSha256": "a" * 64}, {"newPermissions": []},
            {"maxInstallDispatches": 2}, {"maxInstallDispatches": True},
            {"installationQuiescence": {}},
            {"allowedModes": ["install"]}, {"before": {"count": 362}},
            {"after": {"count": 369}}, {"noAutomaticRetryRepairOrRollback": False},
        ]
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                cfg, env, authority, raw, now = self.authority_fixture(change)
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
                    with self.assertRaisesRegex(self.module.Stop, "^owner_authority_scope_mismatch$"):
                        self.module.approval_gate(cfg, env, credentials=False)

    def test_authority_cannot_be_future_expired_or_long_lived(self):
        cases = [
            {"approvedAtEpoch": NOW + 1}, {"expiresAtEpoch": NOW},
            {"approvedAtEpoch": NOW - 100_000, "expiresAtEpoch": NOW + 60},
            {"approvedAtEpoch": True}, {"expiresAtEpoch": str(NOW + 60)},
        ]
        for index, change in enumerate(cases):
            with self.subTest(case=index):
                cfg, env, authority, raw, now = self.authority_fixture(change)
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
                    with self.assertRaisesRegex(self.module.Stop, "^owner_authority_expired_or_invalid$"):
                        self.module.approval_gate(cfg, env, credentials=False)

    def test_authority_requires_exact_quiescence_scope_and_rejects_legacy_pause_facts(self):
        missing = copy.deepcopy(EXPECTED_QUIESCENCE)
        del missing["affectedInFlightTransactionsMustBeDrained"]
        partial = copy.deepcopy(EXPECTED_QUIESCENCE)
        partial["requiredForInstall"] = partial["requiredForInstall"][:-1]
        changed = copy.deepcopy(EXPECTED_QUIESCENCE)
        changed["unrelatedRetentionAndNotificationJournalWritersRequirePause"] = True
        extra = {**EXPECTED_QUIESCENCE, "allDatabaseWritersPaused": True}
        cases = [{"installationQuiescence": value} for value in (None, True, [], missing, partial, changed, extra)]
        cases += [{"otherDatabaseWritersPausedForInstall": value} for value in (True, False)]
        for change in cases:
            with self.subTest(change=change):
                cfg, env, authority, raw, now = self.authority_fixture(change)
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
                    with self.assertRaisesRegex(self.module.Stop, "^owner_authority_scope_mismatch$"):
                        self.module.approval_gate(cfg, env, credentials=False)

    def test_authority_cannot_omit_or_broaden_an_individual_permission(self):
        permissions = copy.deepcopy(self.contract["newPermissions"])
        omitted = permissions[:-1]
        broadened = copy.deepcopy(permissions)
        broadened[0]["grantees"] = [*broadened[0]["grantees"], "PUBLIC"]
        changed_bound = copy.deepcopy(permissions)
        changed_bound[0]["resourceBound"] = "unbounded workload approved implicitly"
        changed_capacity = copy.deepcopy(permissions)
        changed_capacity[1]["resourceBounds"]["maxFinalOccupancyRows"] = 2001
        false_execution_budget = copy.deepcopy(permissions)
        false_execution_budget[1]["resourceBounds"]["executionWorkBudgetEstablished"] = True
        false_snapshot = copy.deepcopy(permissions)
        false_snapshot[2]["resourceBounds"]["multipleBatchesSingleSnapshot"] = True
        for changed in (omitted, broadened, changed_bound, changed_capacity, false_execution_budget, false_snapshot):
            with self.subTest(permissions=changed):
                cfg, env, authority, raw, now = self.authority_fixture({"newPermissions": changed})
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
                    with self.assertRaisesRegex(self.module.Stop, "^owner_authority_scope_mismatch$"):
                        self.module.approval_gate(cfg, env, credentials=False)

    def test_dispatch_must_be_first_attempt_on_manual_main(self):
        cfg, original_env, authority, raw, now = self.authority_fixture()
        cases = [
            ({"GITHUB_RUN_ATTEMPT": "2"}, "workflow_rerun_forbidden"),
            ({"GITHUB_EVENT_NAME": "push"}, "manual_main_only"),
            ({"GITHUB_REF": "refs/heads/draft"}, "manual_main_only"),
            ({"GITHUB_REPOSITORY": "attacker/fork"}, "wrong_repository"),
            ({"RELEASE_MODE": "repair"}, "invalid_release_mode"),
            ({"RELEASE_MODE": "install"}, "manual_ack_missing"),
        ]
        for change, reason in cases:
            with self.subTest(change=change):
                env = {**original_env, **change}
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
                    with self.assertRaisesRegex(self.module.Stop, "^" + reason + "$"):
                        self.module.approval_gate(cfg, env, credentials=False)

    def test_authority_only_gate_defaults_to_preflight_without_secrets(self):
        cfg, env, authority, raw, now = self.authority_fixture()
        for key in ("SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN", "GH_TOKEN"):
            del env[key]
        with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
            self.assertEqual(self.module.approval_gate(cfg, env, credentials=False), "preflight")
            with self.assertRaisesRegex(self.module.Stop, "^provided_db_password_required$"):
                self.module.approval_gate(cfg, env)

    def test_preflight_with_credentials_needs_no_runtime_pause_attestation(self):
        cfg, env, authority, raw, now = self.authority_fixture()
        self.assertNotIn("INSTALL_PAUSE_ACK", env)
        self.assertNotIn("INSTALL_PAUSE_AT_EPOCH", env)
        with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now), patch.object(self.module, "install_pause_gate", side_effect=forbidden) as pause:
            self.assertEqual(self.module.approval_gate(cfg, env), "preflight")
            pause.assert_not_called()

    def test_install_missing_or_wrong_pause_ack_stops_before_credentials_and_helpers(self):
        for ack in (None, "", PAUSE_ACK.lower(), PAUSE_ACK + " ", "ALL DATABASE WRITERS PAUSED"):
            with self.subTest(ack=ack):
                cfg, env, authority, raw, now = self.authority_fixture()
                env = self.install_env(env)
                if ack is None:
                    del env["INSTALL_PAUSE_ACK"]
                else:
                    env["INSTALL_PAUSE_ACK"] = ack
                for key in ("SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN", "GH_TOKEN"):
                    del env[key]
                captured = io.StringIO()
                with tempfile.TemporaryDirectory(prefix="inheritance-pause-offline-") as owned:
                    receipt_path = pathlib.Path(owned) / "receipt.json"
                    with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now), patch.object(self.module, "load_contract", return_value=cfg), patch.object(self.module, "SAFE_RECEIPT", str(receipt_path)), patch.object(self.module.sys, "argv", ["offline"]), patch.dict(self.module.os.environ, env, clear=True), patch.object(self.module, "source_gate", side_effect=forbidden) as source, patch.object(self.module, "ca_gate", side_effect=forbidden) as ca, patch.object(self.module, "ci_gate", side_effect=forbidden) as ci, patch.object(self.module, "endpoint", side_effect=forbidden) as endpoint, patch.object(self.module, "install_once", side_effect=forbidden) as install, contextlib.redirect_stdout(captured):
                        self.assertEqual(self.module.main(), 1)
                        for unused in (source, ca, ci, endpoint, install):
                            unused.assert_not_called()
                    receipt = json.loads(receipt_path.read_text())
                    self.assertEqual(receipt["failure"], "install_pause_ack_missing")
                    self.assertFalse(receipt["productionSuccess"])
                    self.assertFalse(receipt["automaticRetry"])

    def test_install_epoch_must_be_exact_ten_digits_before_credentials(self):
        for epoch in (None, "", "180000000", "18000000000", "1800000000000", str(NOW) + ".0", "+" + str(NOW), " " + str(NOW), "１８００００００００", NOW, True):
            with self.subTest(epoch=epoch):
                cfg, env, authority, raw, now = self.authority_fixture()
                env = self.install_env(env)
                if epoch is None:
                    del env["INSTALL_PAUSE_AT_EPOCH"]
                else:
                    env["INSTALL_PAUSE_AT_EPOCH"] = epoch
                for key in ("SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN", "GH_TOKEN"):
                    del env[key]
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=now):
                    for credentials in (False, True):
                        with self.subTest(credentials=credentials), self.assertRaisesRegex(self.module.Stop, "^install_pause_epoch_invalid$"):
                            self.module.approval_gate(cfg, env, credentials=credentials)

    def test_install_pause_age_requires_fresh_nonfuture_attestation(self):
        cfg, original_env, authority, raw, now = self.authority_fixture()
        for age in (0, 299, 299.999, 300, 301, -0.001, -1):
            with self.subTest(age=age):
                # Keep owner authority independently valid throughout all age
                # boundaries so it cannot mask an attestation rejection.
                env = self.install_env(original_env, epoch=now - 299)
                clock = now - 299 + age
                authority["approvedAtEpoch"] = now - 600
                raw = canonical(authority)
                receipt_hash = hashlib.sha256(raw).hexdigest()
                cfg["approvalReceiptSha256"] = receipt_hash
                env["OWNER_APPROVAL_RECEIPT_SHA256"] = receipt_hash
                with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", return_value=clock):
                    if 0 <= age < 300:
                        self.assertEqual(self.module.approval_gate(cfg, env), "install")
                        self.assertEqual(self.module.approval_gate(cfg, env, credentials=False), "install")
                    else:
                        for key in ("SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN", "GH_TOKEN"):
                            del env[key]
                        with self.assertRaisesRegex(self.module.Stop, "^install_pause_attestation_stale_or_future$"):
                            self.module.approval_gate(cfg, env)

    def test_pause_expiring_during_source_and_ca_checks_blocks_cli_without_dispatch_phase(self):
        cfg, env, authority, raw, now = self.authority_fixture()
        env = self.install_env(env)
        clock = [now]
        receipt = {"phase": "read_only_target_and_before", "productionSuccess": False}
        def source_checked(*_args):
            clock[0] = now + 299
        def ca_checked():
            clock[0] = now + 300
        with tempfile.TemporaryDirectory(prefix="inheritance-pause-expiry-offline-") as owned:
            source = pathlib.Path(owned)
            cli = source / "supabase"
            cli.touch()
            with patch.object(self.module, "bounded_json", return_value=(authority, raw)), patch.object(self.module.time, "time", side_effect=lambda: clock[0]), patch.dict(self.module.os.environ, env, clear=True), patch.object(self.module, "source_gate", side_effect=source_checked) as checked_source, patch.object(self.module, "ca_gate", side_effect=ca_checked) as checked_ca, patch.object(self.module, "command", side_effect=forbidden) as command, patch.object(self.module, "snapshot", side_effect=forbidden) as diagnostic:
                self.assertEqual(self.module.approval_gate(cfg, env), "install")
                with self.assertRaisesRegex(self.module.Stop, "^install_pause_attestation_stale_or_future$"):
                    self.module.install_once(cfg, source, cli, "aws-1-ap-northeast-2.pooler.supabase.com", "postgres." + self.module.TARGET, "synthetic-unit-only", receipt)
                checked_source.assert_called_once()
                checked_ca.assert_called_once()
                command.assert_not_called()
                diagnostic.assert_not_called()
        self.assertEqual(receipt["phase"], "read_only_target_and_before")
        self.assertNotIn("cli", receipt)
        self.assertFalse(receipt["productionSuccess"])

    def test_source_gate_rejects_ignored_environment_without_reading_it(self):
        with self.source_fixture() as (source, cfg):
            self.module.source_gate(source, cfg)
            forbidden_file = source / ".env.local"
            forbidden_file.write_text("synthetic-marker-must-never-be-read")
            original = pathlib.Path.read_bytes
            def checked_read(path):
                if path == forbidden_file:
                    raise AssertionError("ignored environment contents were read")
                return original(path)
            with patch.object(pathlib.Path, "read_bytes", checked_read):
                with self.assertRaisesRegex(self.module.Stop, "^project_environment_forbidden$"):
                    self.module.source_gate(source, cfg)

    def test_source_gate_excludes_pr96_files_and_changed_sql(self):
        with self.source_fixture() as (source, cfg):
            extra = source / "supabase/migrations/20261004140438_pr96.sql"
            extra.write_text("-- synthetic excluded source\n")
            with self.assertRaisesRegex(self.module.Stop, "^source_inventory_mismatch$"):
                self.module.source_gate(source, cfg)
            extra.unlink()
            (source / "supabase/migrations" / MIGRATION).write_text("-- changed SQL\n")
            with self.assertRaisesRegex(self.module.Stop, "^source_hash_mismatch$"):
                self.module.source_gate(source, cfg)

    def test_source_gate_rejects_linked_metadata_and_config_options(self):
        with self.source_fixture() as (source, cfg):
            linked = source / "supabase/.temp"
            linked.mkdir()
            with self.assertRaisesRegex(self.module.Stop, "^linked_metadata_forbidden$"):
                self.module.source_gate(source, cfg)
            linked.rmdir()
            config = source / "supabase/config.toml"
            config.write_text(config.read_text() + "[db]\nport = 5432\n")
            with self.assertRaisesRegex(self.module.Stop, "^minimal_project_config_required$"):
                self.module.source_gate(source, cfg)

    def test_snapshot_verifies_exact_versions_and_catalog_before_and_after(self):
        cfg, before, after = self.snapshot_fixture()
        self.module.verify_snapshot(before, cfg)
        self.module.verify_snapshot(after, cfg, post=True, before=before)
        changed = copy.deepcopy(before)
        changed["versions"][-1]["version"] = "20261004140438"
        with self.assertRaisesRegex(self.module.Stop, "^ledger_mismatch_stop_no_retry$"):
            self.module.verify_snapshot(changed, cfg)

    def test_snapshot_rejects_duplicate_unsorted_or_noncanonical_ledger_rows(self):
        cfg, before, _ = self.snapshot_fixture()
        cases = []
        duplicate = copy.deepcopy(before)
        duplicate["versions"][1] = copy.deepcopy(duplicate["versions"][0])
        cases.append((duplicate, "ledger_order_or_duplicate_failed"))
        unordered = copy.deepcopy(before)
        unordered["versions"][0:2] = reversed(unordered["versions"][0:2])
        cases.append((unordered, "ledger_order_or_duplicate_failed"))
        wrong_name = copy.deepcopy(before)
        wrong_name["versions"][0]["name"] += "_changed"
        cases.append((wrong_name, "ledger_mismatch_stop_no_retry"))
        extra_field = copy.deepcopy(before)
        extra_field["versions"][0]["statements"] = "never expose raw SQL"
        cases.append((extra_field, "ledger_shape_invalid"))
        for value, reason in cases:
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(self.module.Stop, "^" + reason + "$"):
                    self.module.verify_snapshot(value, cfg)

    def test_catalog_rejects_body_owner_acl_and_grant_option_drift(self):
        cfg, before, after = self.snapshot_fixture()
        observed = after["functions"][0]
        for field, replacement in [("owner", "service_role"), ("bodyHash", "a" * 64), ("securityDefiner", not observed["securityDefiner"]), ("anonExecute", not observed["anonExecute"])]:
            with self.subTest(field=field):
                changed = copy.deepcopy(after)
                changed["functions"][0][field] = replacement
                with self.assertRaisesRegex(self.module.Stop, "^function_body_or_acl_mismatch_stop_no_retry$"):
                    self.module.verify_snapshot(changed, cfg, post=True, before=before)
        for added_acl in [
            {"grantee": "PUBLIC", "grantor": "postgres", "privilege": "EXECUTE", "grantable": False},
            {"grantee": "authenticated", "grantor": "postgres", "privilege": "EXECUTE", "grantable": True},
        ]:
            with self.subTest(acl=added_acl):
                changed = copy.deepcopy(after)
                changed["functions"][0]["acl"].append(added_acl)
                with self.assertRaisesRegex(self.module.Stop, "^function_body_or_acl_mismatch_stop_no_retry$"):
                    self.module.verify_snapshot(changed, cfg, post=True, before=before)

    def test_post_state_requires_same_before_names_and_unchanged_writer(self):
        cfg, before, after = self.snapshot_fixture()
        prior_drift = copy.deepcopy(before)
        prior_drift["versions"][0]["name"] += "_changed"
        with self.assertRaisesRegex(self.module.Stop, "^only_one_canonical_ledger_insert_required$"):
            self.module.verify_snapshot(after, cfg, post=True, before=prior_drift)
        prior_drift = copy.deepcopy(before)
        writer = "dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)"
        next(row for row in prior_drift["functions"] if row["signature"] == writer)["bodyHash"] = "a" * 32
        with self.assertRaisesRegex(self.module.Stop, "^unchanged_august_writer_mismatch$"):
            self.module.verify_snapshot(after, cfg, post=True, before=prior_drift)

    def test_snapshot_sql_is_read_only_catalog_metadata_and_body_hashes(self):
        sql = self.module.snapshot_sql(self.contract)
        self.assertIn("SET TRANSACTION READ ONLY", sql)
        self.assertIn("statement_timeout='15s'", sql)
        self.assertIn("lock_timeout='5s'", sql)
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("supabase_migrations.schema_migrations", sql)
        self.assertIn("to_regprocedure(signature)", sql)
        self.assertIn("aclexplode", sql)
        self.assertIn("md5(o.prosrc)", sql)
        self.assertIn("sha256(convert_to(o.prosrc,'UTF8'))", sql)
        # Function signatures only appear as quoted registry data. No function
        # in either observed catalog may be invoked as a business/projection RPC.
        wanted = [{"signature": row["signature"], "hashAlgorithm": row["bodyHashAlgorithm"]}
                  for row in self.contract["afterCatalog"]]
        signature_data = self.module.quote(json.dumps(wanted, separators=(",", ":")))
        self.assertIn(signature_data, sql)
        sql_without_signature_data = sql.replace(signature_data, "'offline-observed-signature-data'")
        for row in self.contract["afterCatalog"]:
            self.assertNotIn(row["signature"].split("(", 1)[0], sql_without_signature_data)
        self.assertNotRegex(sql, r"(?i)\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL|DO)\b")
        self.assertNotRegex(sql, r"(?i)'(?:prosrc|body|sql|statements)'\s*,")

    def test_snapshot_uses_verify_full_and_rejects_session_mismatch(self):
        cfg, before, _ = self.snapshot_fixture()
        wrong = copy.deepcopy(before)
        wrong["tls"] = False
        result = types.SimpleNamespace(returncode=0, stdout=json.dumps(wrong), stderr="")
        with patch.object(self.module, "ca_gate"), patch.object(self.module.subprocess, "run", return_value=result) as process:
            with self.assertRaisesRegex(self.module.Stop, "^snapshot_session_boundary_failed$"):
                self.snapshot_impl(cfg, "aws-1-ap-northeast-2.pooler.supabase.com", "postgres." + self.module.TARGET, "synthetic-unit-only")
            env = process.call_args.kwargs["env"]
            self.assertEqual(env["PGSSLMODE"], "verify-full")
            self.assertEqual(env["PGPORT"], "5432")
            self.assertEqual(env["PGSSLROOTCERT"], self.module.CA)
            self.assertNotIn("SUPABASE_ACCESS_TOKEN", env)
            self.assertNotIn("GH_TOKEN", env)

    def test_install_failure_has_one_command_and_at_most_one_diagnostic_snapshot(self):
        cfg, before, _ = self.snapshot_fixture()
        failures = [
            {"exit": 1, "timeout": False, "outputLimitExceeded": False},
            {"exit": -15, "timeout": True, "outputLimitExceeded": False},
            {"exit": -15, "timeout": False, "outputLimitExceeded": True},
        ]
        for result in failures:
            for diagnostic_available in (True, False):
                with self.subTest(result=result, diagnostic_available=diagnostic_available):
                    receipt = {}
                    with tempfile.TemporaryDirectory(prefix="inheritance-cli-offline-") as owned:
                        source = pathlib.Path(owned)
                        cli = source / "supabase"
                        cli.touch()
                        snapshot_behavior = {"return_value": before} if diagnostic_available else {"side_effect": self.module.Stop("read_only_snapshot_failed")}
                        with patch.dict(self.module.os.environ, self.install_env({}), clear=True), patch.object(self.module.time, "time", return_value=NOW), patch.object(self.module, "source_gate"), patch.object(self.module, "ca_gate"), patch.object(self.module, "command", return_value=result) as command, patch.object(self.module, "snapshot", **snapshot_behavior) as diagnostic:
                            with self.assertRaisesRegex(self.module.Stop, "^cli_failed_unknown_state_stop_no_retry$"):
                                self.module.install_once(cfg, source, cli, "aws-1-ap-northeast-2.pooler.supabase.com", "postgres." + self.module.TARGET, "synthetic-unit-only", receipt)
                            command.assert_called_once()
                            diagnostic.assert_called_once()
                            argv, env, cwd, seconds = command.call_args.args
                            self.assertEqual(argv[:3], [str(cli), "db", "push"])
                            self.assertEqual(argv[-2:], ["--skip-vault", "--yes"])
                            self.assertNotIn("--include-all", argv)
                            self.assertNotIn("repair", argv)
                            self.assertIn("sslmode=verify-full", argv[argv.index("--db-url") + 1])
                            self.assertNotIn("synthetic-unit-only", " ".join(argv))
                            self.assertEqual(set(env), {"PATH", "LANG", "PGPASSWORD", "SUPABASE_TELEMETRY_DISABLED"})
                            self.assertEqual(cwd, source)
                            self.assertEqual(seconds, 600)
                    self.assertEqual(receipt["phase"], "failed_unknown_state_stop_no_retry")
                    self.assertIn("unknown", json.dumps(receipt["afterFailure"]))
                    self.assertNotIn("synthetic-unit-only", json.dumps(receipt))

    def test_install_success_still_requires_later_postflight_evidence(self):
        receipt = {"productionSuccess": False}
        result = {"exit": 0, "timeout": False, "outputLimitExceeded": False}
        with tempfile.TemporaryDirectory(prefix="inheritance-cli-offline-") as owned:
            source = pathlib.Path(owned)
            cli = source / "supabase"
            cli.touch()
            with patch.dict(self.module.os.environ, self.install_env({}), clear=True), patch.object(self.module.time, "time", return_value=NOW), patch.object(self.module, "source_gate"), patch.object(self.module, "ca_gate"), patch.object(self.module, "command", return_value=result) as command, patch.object(self.module, "snapshot", side_effect=forbidden) as diagnostic:
                self.module.install_once(self.contract, source, cli, "aws-1-ap-northeast-2.pooler.supabase.com", "postgres." + self.module.TARGET, "synthetic-unit-only", receipt)
                command.assert_called_once()
                diagnostic.assert_not_called()
        self.assertFalse(receipt["productionSuccess"])

    def test_preflight_main_never_initializes_cli_or_calls_install(self):
        cfg, before, _ = self.snapshot_fixture()
        captured = io.StringIO()
        with tempfile.TemporaryDirectory(prefix="inheritance-preflight-offline-") as owned:
            receipt_path = pathlib.Path(owned) / "receipt.json"
            env = {
                "GITHUB_WORKSPACE": owned, "GH_TOKEN": "synthetic-token-marker",
                "SUPABASE_ACCESS_TOKEN": "synthetic-token-marker", "SUPABASE_DB_PASSWORD": "synthetic-password-marker",
            }
            # RUNNER_TEMP intentionally absent: touching the install-only path
            # in default preflight must fail this test before any child launch.
            with patch.object(self.module, "SAFE_RECEIPT", str(receipt_path)), patch.object(self.module.sys, "argv", ["offline"]), patch.dict(self.module.os.environ, env, clear=True), patch.object(self.module, "load_contract", return_value=cfg), patch.object(self.module, "approval_gate", return_value="preflight"), patch.object(self.module, "source_gate"), patch.object(self.module, "ca_gate"), patch.object(self.module, "ci_gate"), patch.object(self.module.shutil, "which", return_value="/offline/psql"), patch.object(self.module, "endpoint", return_value=("aws-1-ap-northeast-2.pooler.supabase.com", "postgres." + self.module.TARGET)), patch.object(self.module, "snapshot", return_value=before) as snapshot, patch.object(self.module, "install_once", side_effect=forbidden) as install, contextlib.redirect_stdout(captured):
                self.assertEqual(self.module.main(), 0)
                snapshot.assert_called_once()
                install.assert_not_called()
            receipt_text = receipt_path.read_text()
            receipt = json.loads(receipt_text)
            self.assertTrue(receipt["readOnlyPreflightSuccess"])
            self.assertFalse(receipt["productionSuccess"])
            self.assertFalse(receipt["automaticRetry"])
            self.assertFalse(receipt["historyRepair"])
            self.assertNotIn("synthetic-token-marker", receipt_text + captured.getvalue())
            self.assertNotIn("synthetic-password-marker", receipt_text + captured.getvalue())

    def test_unknown_main_failure_is_redacted_and_not_retried(self):
        cfg, _, _ = self.snapshot_fixture()
        captured = io.StringIO()
        marker = "synthetic-provider-detail-must-not-escape"
        with tempfile.TemporaryDirectory(prefix="inheritance-failure-offline-") as owned:
            receipt_path = pathlib.Path(owned) / "receipt.json"
            with patch.object(self.module, "SAFE_RECEIPT", str(receipt_path)), patch.object(self.module.sys, "argv", ["offline"]), patch.dict(self.module.os.environ, {"GITHUB_WORKSPACE": owned}, clear=True), patch.object(self.module, "load_contract", return_value=cfg), patch.object(self.module, "approval_gate", return_value="preflight"), patch.object(self.module, "source_gate", side_effect=RuntimeError(marker)) as source, patch.object(self.module, "ca_gate", side_effect=forbidden) as ca, contextlib.redirect_stdout(captured):
                self.assertEqual(self.module.main(), 1)
                source.assert_called_once()
                ca.assert_not_called()
            receipt_text = receipt_path.read_text()
            receipt = json.loads(receipt_text)
            self.assertEqual(receipt["failure"], "unexpected_failure_unknown_state_stop_no_retry")
            self.assertFalse(receipt["automaticRetry"])
            self.assertFalse(receipt["historyRepair"])
            self.assertNotIn(marker, receipt_text + captured.getvalue())


if __name__ == "__main__":
    unittest.main()
