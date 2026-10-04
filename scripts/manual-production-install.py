"""Manually install exactly seven owner-approved canonical migrations once."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

TARGET = "slnjqlzzhewblvttiidk"
REGION = "ap-northeast-2"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
ACK = "INSTALL ONLY SEVEN REVIEWED MIGRATIONS"
READ_ACK = "READ ONLY PRODUCTION PREREQUISITE CHECK"
CA = "/etc/ssl/certs/ca-certificates.crt"
LIMIT = 2 * 1024 * 1024


class Stop(Exception):
    pass


def require(ok, reason):
    if not ok:
        raise Stop(reason)


def digest_versions(rows):
    return hashlib.sha256("".join(r["version"] + "\n" for r in rows).encode()).hexdigest()


def approval_gate(cfg, env):
    require(cfg.get("proposalOnly") is False, "proposal_not_activated")
    require(HEX40.fullmatch(cfg["approvedSourceSha"]), "approved_source_unpinned")
    mode = env.get("RELEASE_MODE", "preflight")
    require(mode in ("preflight", "install"), "invalid_release_mode")
    if mode == "install":
        require(HEX64.fullmatch(cfg["approvalReceiptSha256"]), "owner_approval_unpinned")
        require(env.get("INSTALL_ACK") == ACK, "manual_ack_missing")
        require(env.get("INSTALL_APPROVAL_RECEIPT_SHA256") == cfg["approvalReceiptSha256"], "approval_mismatch")
    else:
        require(HEX64.fullmatch(cfg["readOnlyApprovalReceiptSha256"]), "read_only_approval_unpinned")
        require(env.get("INSTALL_ACK") == READ_ACK, "read_only_ack_missing")
        require(env.get("READ_ONLY_APPROVAL_RECEIPT_SHA256") == cfg["readOnlyApprovalReceiptSha256"], "read_only_approval_mismatch")
    require(env.get("GITHUB_REPOSITORY") == "tipsedu2019/tips_dashboard", "wrong_repository")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "manual_only")
    # Check before API access, psql, or any CLI initialization. Never fall back.
    require(bool(env.get("SUPABASE_DB_PASSWORD", "").strip()), "provided_db_password_required")
    require(bool(env.get("SUPABASE_ACCESS_TOKEN", "").strip()), "existing_api_token_required")
    require(bool(env.get("GH_TOKEN", "").strip()), "read_only_github_token_required")
    require(cfg["target"] == {"projectRef": TARGET, "region": REGION, "databaseUser": "postgres"}, "wrong_target")
    require(len(cfg["orderedSeven"]) == 7, "seven_required")
    require(all(HEX64.fullmatch(r["sha256"]) for r in cfg["allSourceMigrations"]), "source_hash_unpinned")
    require(all(HEX64.fullmatch(r["sha256"]) for r in cfg["orderedSeven"]), "seven_hash_unpinned")


def api(url, token):
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(LIMIT + 1)
        require(len(body) <= LIMIT, "metadata_size_limit")
        return json.loads(body)
    except (urllib.error.URLError, ValueError):
        raise Stop("read_only_metadata_failed") from None


def source_gate(source, cfg):
    actual = subprocess.run(["git", "rev-parse", "HEAD"], cwd=source, capture_output=True, text=True, check=True).stdout.strip()
    require(actual == cfg["approvedSourceSha"], "source_head_mismatch")
    require(not subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=source, capture_output=True, text=True, check=True).stdout, "source_not_clean")
    directory = source / "supabase/migrations"
    actual_files = sorted(p.name for p in directory.glob("*.sql"))
    require(actual_files == [r["file"] for r in cfg["allSourceMigrations"]], "source_inventory_mismatch")
    for row in cfg["allSourceMigrations"]:
        require(hashlib.sha256((directory / row["file"]).read_bytes()).hexdigest() == row["sha256"], "source_hash_mismatch")
    seven = {r["version"] for r in cfg["orderedSeven"]}
    local = [{"version": name[:14]} for name in actual_files]
    require(digest_versions(local) == cfg["after"]["versionsSha256"], "local_full_versions_mismatch")
    prefix = [r for r in local if r["version"] not in seven]
    require(len(prefix) == 362 and digest_versions(prefix) == cfg["before"]["versionsSha256"], "local_prefix_mismatch")
    # No project env, linked metadata, or alternate config may change credential or target resolution.
    require(not list(source.glob(".env*")) and not list((source / "supabase").glob(".env*")), "project_environment_forbidden")
    require(not (source / "supabase/.temp").exists(), "linked_metadata_forbidden")
    require((source / "supabase/config.toml").read_text() == 'project_id = "' + TARGET + '"\n', "minimal_project_config_required")


def ci_gate(cfg, token):
    result = api("https://api.github.com/repos/tipsedu2019/tips_dashboard/commits/" + cfg["approvedSourceSha"] + "/check-runs?per_page=100", token)
    required = {"supabase-sql-review", "supabase-schema-contract", "free-tier-guardrails"}
    found = {}
    for check in result.get("check_runs", []):
        if check["name"] in required and check.get("head_sha") == cfg["approvedSourceSha"]:
            # Fail closed on duplicate/latest ambiguity rather than selecting an older success.
            require(check["name"] not in found, "duplicate_check_requires_review")
            found[check["name"]] = check
    require(set(found) == required, "required_checks_missing")
    require(all(c["status"] == "completed" and c["conclusion"] == "success" and c.get("app", {}).get("slug") == "github-actions" for c in found.values()), "required_checks_not_green")


def endpoint(token):
    project = api("https://api.supabase.com/v1/projects/" + TARGET, token)
    require(isinstance(project, dict), "project_metadata_shape_invalid")
    require(project.get("id") == TARGET and project.get("region") == REGION and project.get("status") == "ACTIVE_HEALTHY", "project_metadata_mismatch")
    configs = api("https://api.supabase.com/v1/projects/" + TARGET + "/config/database/pooler", token)
    require(isinstance(configs, list) and all(isinstance(row, dict) for row in configs), "pooler_metadata_shape_invalid")
    primary = [r for r in configs if r.get("database_type") == "PRIMARY"]
    require(len(primary) == 1, "primary_pooler_ambiguous")
    connection = primary[0].get("connection_string")
    require(isinstance(connection, str) and len(connection) <= 4096 and connection.isascii() and all(ord(char) > 32 and ord(char) != 127 for char in connection), "pooler_connection_string_shape_invalid")
    # Encode only the exact non-secret password placeholder. Do not decode
    # credentials or normalize a host, tenant, option, or arbitrary URI.
    connection = connection.replace(":[YOUR-PASSWORD]@", ":%5BYOUR-PASSWORD%5D@", 1)
    try:
        value = urllib.parse.urlsplit(connection)
        host, user, password, port = value.hostname, value.username, value.password, value.port
    except (ValueError, TypeError):
        raise Stop("pooler_url_parse_failed") from None
    require(value.scheme in ("postgres", "postgresql"), "pooler_scheme_invalid")
    require(user == "postgres." + TARGET and value.path == "/postgres", "pooler_tenant_mismatch")
    require(password in (None, "", "[YOUR-PASSWORD]", "%5BYOUR-PASSWORD%5D"), "pooler_password_must_not_be_received")
    require(not value.query and not value.fragment, "pooler_options_requires_review")
    require(bool(re.fullmatch(r"aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com", host or "")), "pooler_region_hostname_mismatch")
    require(port in (5432, 6543), "pooler_port_unexpected")
    # Always choose the official session pooler port. Never a transaction-mode connection.
    return host, user


def command(argv, env, cwd, seconds):
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    totals = {"stdoutBytes": 0, "stderrBytes": 0}
    exceeded = threading.Event()

    def drain(stream, key):
        while True:
            chunk = stream.read1(65536)
            if not chunk:
                break
            totals[key] += len(chunk)
            if totals[key] > LIMIT:
                exceeded.set()
        stream.close()

    threads = [threading.Thread(target=drain, args=(process.stdout, "stdoutBytes"), daemon=True), threading.Thread(target=drain, args=(process.stderr, "stderrBytes"), daemon=True)]
    for thread in threads:
        thread.start()
    timed_out = False
    def terminate_owned():
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
    try:
        deadline = time.monotonic() + seconds
        while process.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                terminate_owned()
                break
            # The drain event wakes this wait immediately; exceeding the output
            # boundary must terminate the owned group before further work.
            if exceeded.wait(timeout=min(0.05, remaining)):
                terminate_owned()
                break
    finally:
        if process.poll() is None:
            terminate_owned()
        process.wait(timeout=5)
        for thread in threads:
            thread.join(timeout=5)
        if any(t.is_alive() for t in threads):
            # A child retained a pipe after the CLI leader exited. It is still in
            # this owned group; close/reap it rather than losing the boundary.
            terminate_owned()
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    for thread in threads:
        thread.join(timeout=5)
    require(not any(t.is_alive() for t in threads), "owned_child_drain_incomplete")
    return {"exit": process.returncode, "timeout": timed_out, "outputLimitExceeded": exceeded.is_set(), "stopReason": "output_limit_unknown_state_stop_no_retry" if exceeded.is_set() else None, **totals}


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def snapshot(cfg, host, user, password, post=False):
    tables = "ARRAY[" + ",".join(quote(v) for v in cfg["tables"]) + "]::text[]"
    functions = "ARRAY[" + ",".join(quote(v) for v in cfg["functions"]) + "]::text[]"
    sql = "\\set VERBOSITY sqlstate\nBEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s';\n"
    sql += f"""WITH target_tables AS (SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY({tables})), target_functions AS (SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY({functions}))
SELECT json_build_object('user',current_user,'readOnly',current_setting('transaction_read_only'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'versions',(SELECT coalesce(json_agg(json_build_object('version',version,'name',name) ORDER BY version),'[]') FROM supabase_migrations.schema_migrations),'tables',(SELECT count(*) FROM target_tables),'rls',(SELECT count(*) FROM target_tables WHERE relrowsecurity),'appTablePrivileges',(SELECT coalesce(bool_or(has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM aclexplode(coalesce(relacl,acldefault('r',relowner))) a WHERE a.grantee=0)),false) FROM target_tables),'functions',(SELECT count(*) FROM target_functions),'securityDefiner',(SELECT count(*) FROM target_functions WHERE prosecdef),'ownedFunctions',(SELECT count(*) FROM target_functions WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')));
"""
    if post:
        rpc_json = json.dumps([{ "signature": r["signature"], "role": r["directExecuteRole"]} for r in cfg["rpc"]])
        sql += f"""WITH rpc AS (SELECT signature,role,to_regprocedure(signature)::oid AS oid FROM jsonb_to_recordset({quote(rpc_json)}::jsonb) AS x(signature text,role text)), privileges AS (SELECT signature,role,oid,has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,has_function_privilege('service_role',oid,'EXECUTE') AS service,EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=rpc.oid AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public FROM rpc)
SELECT json_build_object('aclCorrect',bool_and(oid IS NOT NULL AND NOT anon AND NOT public AND authenticated=(role='authenticated') AND service=(role='service_role'))) FROM privileges;
SELECT json_build_object('issuanceOff',(SELECT count(*)=1 AND bool_and(NOT issuance_enabled AND public_origin IS NULL) FROM dashboard_private.ai_agent_chat_support),'spacesOff',(SELECT count(*)=7 AND bool_and(NOT configured AND resource_name IS NULL AND public_origin IS NULL) FROM dashboard_private.chat_space_configuration),'credentialCount',(SELECT count(*) FROM dashboard_private.ai_agent_credentials),'credentialGrantCount',(SELECT count(*) FROM dashboard_private.ai_agent_credential_grants),'chatCredentialSpaceGrantCount',(SELECT count(*) FROM dashboard_private.chat_credential_space_grants),'userSpacePermissionCount',(SELECT count(*) FROM dashboard_private.chat_user_space_permissions),'domainActionGrantCount',(SELECT count(*) FROM dashboard_private.ai_agent_domain_action_grants),'domainActionRegistryCount',(SELECT count(*) FROM dashboard_private.ai_agent_action_registry),'domainActionRegistryEnabledCount',(SELECT count(*) FROM dashboard_private.ai_agent_action_registry WHERE enabled),'validatedExactDeferredFks',(SELECT count(*) FROM pg_constraint c JOIN (VALUES ('ai_agent_claim_credential_fk','dashboard_private.ai_agent_request_claims'::regclass,'dashboard_private.ai_agent_credentials'::regclass),('ai_agent_event_credential_fk','dashboard_private.ai_agent_request_events'::regclass,'dashboard_private.ai_agent_credentials'::regclass),('ai_agent_event_issuer_fk','dashboard_private.ai_agent_request_events'::regclass,'public.profiles'::regclass)) expected(name,origin,referent) ON c.conname=expected.name AND c.conrelid=expected.origin AND c.confrelid=expected.referent WHERE c.contype='f' AND c.convalidated));
"""
    sql += "ROLLBACK;\n"
    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "PGHOST": host, "PGPORT": "5432", "PGUSER": user, "PGDATABASE": "postgres", "PGPASSWORD": password, "PGSSLMODE": "verify-full", "PGSSLROOTCERT": CA, "PGCONNECT_TIMEOUT": "10"}
    try:
        result = subprocess.run(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], env=env, input=sql, capture_output=True, text=True, timeout=30)
        require(result.returncode == 0 and len(result.stdout) <= LIMIT, "read_only_snapshot_failed")
        records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        require(len(records) == (3 if post else 1), "snapshot_shape_invalid")
        require(records[0]["user"] == "postgres" and records[0]["readOnly"] == "on" and records[0]["tls"] is True, "snapshot_session_boundary_failed")
        return records
    except (subprocess.TimeoutExpired, ValueError):
        raise Stop("read_only_snapshot_failed") from None


def verify_initial(value, cfg):
    rows = value["versions"]
    require(len(rows) == cfg["before"]["count"] and rows[-1]["version"] == cfg["before"]["latest"] and digest_versions(rows) == cfg["before"]["versionsSha256"], "initial_ledger_mismatch_stop_no_retry")
    require(value["tables"] == 0 and value["functions"] == 0, "existing_ai_objects_stop_no_retry")


def verify_final(records, cfg):
    value, acl, defaults = records
    rows = value["versions"]
    require(len(rows) == 369 and rows[-1]["version"] == cfg["after"]["latest"] and digest_versions(rows) == cfg["after"]["versionsSha256"], "final_ledger_mismatch_stop_no_retry")
    expected = [{"version": r["version"], "name": r["name"]} for r in cfg["orderedSeven"]]
    require(rows[-7:] == expected, "final_seven_names_mismatch")
    require(value["tables"] == value["rls"] == 21 and value["functions"] == value["ownedFunctions"] == 48 and value["securityDefiner"] == 18, "final_catalog_mismatch")
    require(value["appTablePrivileges"] is False, "direct_application_table_privilege_detected")
    require(acl["aclCorrect"] is True, "final_rpc_acl_mismatch")
    require(defaults == {"issuanceOff": True, "spacesOff": True, "credentialCount": 0, "credentialGrantCount": 0, "chatCredentialSpaceGrantCount": 0, "userSpacePermissionCount": 0, "domainActionGrantCount": 0, "domainActionRegistryCount": 0, "domainActionRegistryEnabledCount": 0, "validatedExactDeferredFks": 3}, "final_defaults_or_fk_mismatch")


def main():
    receipt = {"proposalOnly": False, "phase": "approval", "productionSuccess": False, "automaticRetry": False}
    try:
        cfg = json.loads(pathlib.Path(sys.argv[1]).read_text())
        source = pathlib.Path(sys.argv[2]).resolve()
        cli = str(pathlib.Path(sys.argv[3]).resolve())
        approval_gate(cfg, os.environ)
        mode = os.environ.get("RELEASE_MODE", "preflight")
        receipt["mode"] = mode
        receipt["sourceSha"] = cfg["approvedSourceSha"]
        receipt["phase"] = "source_and_ci"
        source_gate(source, cfg)
        if mode == "install":
            ci_gate(cfg, os.environ["GH_TOKEN"])
        require(shutil.which("psql") and pathlib.Path(CA).is_file(), "psql_or_system_ca_missing")
        receipt["phase"] = "read_only_target_and_initial_snapshot"
        host, user = endpoint(os.environ["SUPABASE_ACCESS_TOKEN"])
        before = snapshot(cfg, host, user, os.environ["SUPABASE_DB_PASSWORD"])[0]
        verify_initial(before, cfg)
        receipt["before"] = {"ledgerCount": 362, "versionsSha256": digest_versions(before["versions"]), "aiTables": 0, "aiFunctions": 0, "readOnly": True, "tlsVerified": True}
        if mode == "preflight":
            receipt["readOnlyPreflightSuccess"] = True
            receipt["phase"] = "read_only_preflight_complete_no_cli_initialized"
            pathlib.Path("safe-production-install-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps(receipt))
            return 0
        require(pathlib.Path(cli).is_file(), "pinned_cli_missing")
        # No link, login, dry-run, password flag, project-ref, custom migration view,
        # include-all, roles, seed, vault update, repair, or retry.
        dsn = f"host={host} port=5432 user={user} dbname=postgres sslmode=verify-full sslrootcert={CA} connect_timeout=10"
        child_env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "PGPASSWORD": os.environ["SUPABASE_DB_PASSWORD"], "SUPABASE_TELEMETRY_DISABLED": "1"}
        receipt["phase"] = "one_canonical_cli_push"
        receipt["cli"] = command([cli, "db", "push", "--db-url", dsn, "--skip-vault", "--yes"], child_env, source, 600)
        receipt["phase"] = "read_only_post_checkpoint"
        # Every nonzero exit is a permanent stop for this attempt. A diagnostic
        # read only checkpoint does not authorize continuing or classifying stage7.
        success = receipt["cli"]["exit"] == 0 and not receipt["cli"]["timeout"] and not receipt["cli"]["outputLimitExceeded"]
        if not success:
            try:
                state = snapshot(cfg, host, user, os.environ["SUPABASE_DB_PASSWORD"])[0]
                receipt["afterFailure"] = {"ledgerCount": len(state["versions"]), "versionsSha256": digest_versions(state["versions"]), "aiTables": state["tables"], "aiFunctions": state["functions"], "stateEquivalence": "unknown; stop, no automatic retry or repair"}
            except Stop:
                receipt["afterFailure"] = {"checkpoint": "unavailable; unknown state; stop"}
            raise Stop("cli_failed_stop_no_retry")
        after = snapshot(cfg, host, user, os.environ["SUPABASE_DB_PASSWORD"], post=True)
        verify_final(after, cfg)
        source_gate(source, cfg)
        receipt["after"] = {"ledgerCount": 369, "versionsSha256": digest_versions(after[0]["versions"]), "canonicalSevenNames": True, "tables": 21, "functions": 48, "rlsTables": 21, "directAppTablePrivileges": False, "rpcAclCorrect": True, "issuanceOff": True, "spacesOff": True, "allCredentialPermissionAndDomainGrantCounts": 0, "domainActionRegistryEnabledCount": 0, "validatedExactDeferredFks": 3, "readOnly": True, "tlsVerified": True}
        receipt["productionSuccess"] = True
        receipt["phase"] = "installed_only_no_application_or_provider_activation"
    except Stop as error:
        receipt["failure"] = str(error)
    except Exception:
        receipt["failure"] = "unexpected_failure_stop_no_retry"
    pathlib.Path("safe-production-install-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))
    return 0 if receipt["productionSuccess"] else 1


if __name__ == "__main__":
    def interrupted(_signum, _frame):
        raise Stop("interrupted_unknown_state_stop_no_retry")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
