"""Inactive dedicated PR97 single-migration release draft; never an AI installer.

Replacement PR97 source1ecc/SQLca71 is reviewed; owner authority remains pending.
Only separately approved activation may clear the proposal gate.
No runtime AI import.
CA/transport helper source segments are unchanged from reviewed K SHA31bf00ad.
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import ssl
import stat
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
ACK = "INSTALL ONLY PR97 INHERITANCE MIGRATION ONCE"
READ_ACK = "READ ONLY PR97 INHERITANCE PREFLIGHT"
ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts/inheritance-hotfix-release-manifest.json"
OWNER_RECEIPT = ROOT / "docs/operations/approvals/inheritance-hotfix-owner-approval.json"
CA = str(ROOT / "supabase/certs/prod-ca-2021.crt")
CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
CA_BYTES = 1367
CA_NOT_BEFORE = ssl.cert_time_to_seconds("Apr 28 10:56:53 2021 GMT")
CA_NOT_AFTER = ssl.cert_time_to_seconds("Apr 26 10:56:53 2031 GMT")
LIMIT = 2 * 1024 * 1024
STALE_SOURCE = False  # Exact bounded replacement reviewed; proposal/owner gates stay closed.
SOURCE = "1eccff3254b7024dc242bcffd11eb4505ff0700c"
MIGRATION = "20261004160000_legacy_effective_schedule_inheritance.sql"
SQL_SHA256 = "ca71cf8edc2135723c1a8e527ddbed5c285f6fb72da7a084966d8914597a9eb3"
CONTRACT_SHA256 = "6b2a202708017688960267a25e5da1c351f8eb335de88111c8401f97075770f2"
SAFE_RECEIPT = "inheritance-hotfix-safe-receipt.json"


class Stop(Exception):
    pass

def require(ok, reason):
    if not ok:
        raise Stop(reason)

def ca_gate():
    # This reviewed public CA is fixed to the runner checkout, never an env,
    # argument, downloaded peer certificate, or machine-wide trust bundle.
    path = pathlib.Path(CA)
    require(path.is_absolute() and bool(re.fullmatch(r"[A-Za-z0-9_./-]+", CA)), "pinned_ca_path_invalid")
    require(not any(p.is_symlink() for p in (path, path.parent, path.parent.parent)), "pinned_ca_symlink_forbidden")
    require(hasattr(os, "O_NOFOLLOW"), "pinned_ca_file_boundary_unavailable")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            require(stat.S_ISREG(os.fstat(descriptor).st_mode), "pinned_ca_regular_file_required")
            with os.fdopen(descriptor, "rb", closefd=False) as stream:
                value = stream.read(CA_BYTES + 1)
        finally:
            os.close(descriptor)
    except OSError:
        raise Stop("pinned_ca_unreadable") from None
    # The exact hash binds the independently inspected single public PEM,
    # CA:TRUE, keyCertSign and validity fields. Modified/extra PEM is rejected.
    require(len(value) == CA_BYTES and hashlib.sha256(value).hexdigest() == CA_SHA256, "pinned_ca_hash_mismatch")
    require(CA_NOT_BEFORE <= time.time() < CA_NOT_AFTER, "pinned_ca_validity_failed")

def digest_versions(rows):
    return hashlib.sha256("".join(r["version"] + "\n" for r in rows).encode()).hexdigest()

def api(url, token):
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(LIMIT + 1)
        require(len(body) <= LIMIT, "metadata_size_limit")
        return json.loads(body)
    except (urllib.error.URLError, ValueError):
        raise Stop("read_only_metadata_failed") from None

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

def snapshot_failure_code(stderr):
    # Classify ephemeral stderr into a closed set. Never return provider text,
    # parsed identifiers, or arbitrary SQLSTATE-like fragments.
    if not isinstance(stderr, str) or len(stderr) > LIMIT:
        return "read_only_snapshot_failed"
    matches = set()
    text = stderr.casefold()
    if any(marker in text for marker in ("password authentication failed", "fe_sendauth: no password supplied", "sasl authentication failed")):
        matches.add("read_only_snapshot_authentication_failed")
    if "certificate verify failed" in text:
        matches.add("read_only_snapshot_tls_certificate_verification_failed")
    if "does not match host name" in text:
        matches.add("read_only_snapshot_tls_hostname_mismatch")
    if any(marker in text for marker in ("could not translate host name", "name or service not known", "temporary failure in name resolution", "connection refused", "network is unreachable", "no route to host", "connection timed out", "timeout expired")):
        matches.add("read_only_snapshot_network_failed")
    sqlstates = {
        "42501": "read_only_snapshot_sqlstate_42501",
        "42P01": "read_only_snapshot_sqlstate_42P01",
        "42703": "read_only_snapshot_sqlstate_42703",
        "42883": "read_only_snapshot_sqlstate_42883",
        "42601": "read_only_snapshot_sqlstate_42601",
        "42804": "read_only_snapshot_sqlstate_42804",
        "57014": "read_only_snapshot_sqlstate_57014",
        "55P03": "read_only_snapshot_sqlstate_55P03",
    }
    for state, code in sqlstates.items():
        # VERBOSITY sqlstate emits only severity and state, optionally prefixed
        # by psql's file/line or error marker. Embedded codes/tails stay unknown.
        pattern = r"(?m)^(?:psql:(?:[^:\r\n]+:[0-9]+:|[ \t]+error:)[ \t]*)?(?:ERROR|FATAL):[ \t]+" + state + r"[ \t]*$"
        if re.search(pattern, stderr):
            matches.add(code)
    return next(iter(matches)) if len(matches) == 1 else "read_only_snapshot_failed"

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def bounded_json(path):
    require(path.is_file() and not path.is_symlink(), "public_authority_file_boundary_failed")
    try:
        with path.open("rb") as stream:
            value = stream.read(LIMIT + 1)
        require(len(value) <= LIMIT, "public_authority_size_limit")
        return json.loads(value), value
    except (OSError, ValueError):
        raise Stop("public_authority_unreadable") from None


def load_contract():
    # A transport template cannot approve the withdrawn product candidate.
    require(STALE_SOURCE is False, "stale_product_source_replacement_required")
    envelope, _ = bounded_json(MANIFEST)
    # This gate precedes secret handling, source helpers, API and database calls.
    require(isinstance(envelope, dict) and envelope.get("proposalOnly") is False, "proposal_not_activated")
    require(envelope.get("sourceReviewStatus") == "reviewed_current", "product_source_review_incomplete")
    cfg = envelope.get("contract")
    require(isinstance(cfg, dict) and hashlib.sha256(canonical(cfg)).hexdigest() == CONTRACT_SHA256, "unsigned_contract_mismatch")
    require(cfg["approvedSourceSha"] == SOURCE, "source_not_pr97")
    require(cfg["onlyMigration"]["file"] == MIGRATION and cfg["onlyMigration"]["sha256"] == SQL_SHA256, "only_pr97_sql_required")
    require(cfg["target"] == {"projectRef": TARGET, "region": REGION, "databaseUser": "postgres"}, "wrong_target")
    cfg = dict(cfg)
    cfg["approvalReceiptSha256"] = envelope.get("approvalReceiptSha256")
    return cfg


def install_pause_gate(cfg, env):
    # The immutable authority binds a required scope, not a current pause fact.
    # An operator must freshly attest that scope and hold it until verification.
    pause = cfg["installationQuiescence"]
    require(env.get("INSTALL_PAUSE_ACK") == pause["pauseAck"], "install_pause_ack_missing")
    epoch = env.get("INSTALL_PAUSE_AT_EPOCH", "")
    require(isinstance(epoch, str) and re.fullmatch(r"[0-9]{10}", epoch), "install_pause_epoch_invalid")
    age = time.time() - int(epoch)
    require(0 <= age < pause["pauseAttestationMaxAgeSeconds"], "install_pause_attestation_stale_or_future")


def approval_gate(cfg, env, credentials=True):
    receipt_hash = cfg.get("approvalReceiptSha256")
    require(isinstance(receipt_hash, str) and HEX64.fullmatch(receipt_hash), "owner_authority_pending")
    require(env.get("OWNER_APPROVAL_RECEIPT_SHA256") == receipt_hash, "owner_authority_pin_mismatch")
    authority, raw = bounded_json(OWNER_RECEIPT)
    require(hashlib.sha256(raw).hexdigest() == receipt_hash, "owner_authority_file_mismatch")
    script_hash = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    expected = {
        "approvalKind": "owner_action_time_inheritance_hotfix",
        "sourceSha": SOURCE,
        "sqlSha256": SQL_SHA256,
        "projectRef": TARGET,
        "region": REGION,
        "unsignedContractSha256": CONTRACT_SHA256,
        "scriptSha256": script_hash,
        "caSha256": CA_SHA256,
        "newPermissions": cfg["newPermissions"],
        "before": cfg["before"],
        "after": cfg["after"],
        "allowedModes": ["preflight", "install"],
        "maxInstallDispatches": 1,
        "installationQuiescence": cfg["installationQuiescence"],
        "noAutomaticRetryRepairOrRollback": True,
    }
    require(isinstance(authority, dict) and "otherDatabaseWritersPausedForInstall" not in authority and all(canonical(authority.get(k)) == canonical(v) for k, v in expected.items()), "owner_authority_scope_mismatch")
    now = time.time()
    approved, expires = authority.get("approvedAtEpoch"), authority.get("expiresAtEpoch")
    require(type(approved) in (int, float) and type(expires) in (int, float) and approved <= now < expires <= approved + 86400, "owner_authority_expired_or_invalid")
    require(env.get("GITHUB_REPOSITORY") == "tipsedu2019/tips_dashboard", "wrong_repository")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and env.get("GITHUB_REF") == "refs/heads/main", "manual_main_only")
    require(env.get("GITHUB_RUN_ATTEMPT") == "1", "workflow_rerun_forbidden")
    mode = env.get("RELEASE_MODE", "preflight")
    require(mode in ("preflight", "install"), "invalid_release_mode")
    require(env.get("INSTALL_ACK") == (READ_ACK if mode == "preflight" else ACK), "manual_ack_missing")
    if mode == "install":
        install_pause_gate(cfg, env)
    if credentials:
        require(bool(env.get("SUPABASE_DB_PASSWORD", "").strip()), "provided_db_password_required")
        require(bool(env.get("SUPABASE_ACCESS_TOKEN", "").strip()), "existing_api_token_required")
        require(bool(env.get("GH_TOKEN", "").strip()), "read_only_github_token_required")
    return mode


def source_gate(source, cfg):
    require(source.is_dir() and not source.is_symlink(), "source_directory_invalid")
    def git_read(args):
        result = subprocess.run(["git", *args], cwd=source, capture_output=True, text=True, timeout=20)
        require(result.returncode == 0 and len(result.stdout) <= LIMIT and len(result.stderr) <= LIMIT, "source_metadata_failed")
        return result.stdout
    require(git_read(["rev-parse", "HEAD"]).strip() == SOURCE, "source_head_mismatch")
    require(not git_read(["status", "--porcelain", "--untracked-files=all"]), "source_not_clean")
    directory = source / "supabase/migrations"
    require(directory.is_dir() and not directory.is_symlink(), "migration_directory_invalid")
    actual_files = sorted(p.name for p in directory.glob("*.sql"))
    require(actual_files == [r["file"] for r in cfg["allSourceMigrations"]] and len(actual_files) == 363, "source_inventory_mismatch")
    for row in cfg["allSourceMigrations"]:
        path = directory / row["file"]
        require(path.is_file() and not path.is_symlink(), "migration_file_boundary_failed")
        require(hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"], "source_hash_mismatch")
    versions = [{"version": r["version"]} for r in cfg["allSourceMigrations"]]
    require(len({r["version"] for r in versions}) == 363 and digest_versions(versions) == cfg["after"]["versionsSha256"], "local_canonical_versions_mismatch")
    prefix = versions[:-1]
    require(versions[-1]["version"] == "20261004160000" and len(prefix) == 362 and digest_versions(prefix) == cfg["before"]["versionsSha256"], "local_canonical_prefix_mismatch")
    require(not {r["version"] for r in versions}.intersection(cfg["excluded"]["versions"]), "pr96_lower_versions_forbidden")
    require(not list(source.glob(".env*")) and not list((source / "supabase").glob(".env*")), "project_environment_forbidden")
    require(not (source / "supabase/.temp").exists() and not (source / "supabase/.temp").is_symlink(), "linked_metadata_forbidden")
    config = source / "supabase/config.toml"
    require(config.is_file() and not config.is_symlink() and config.read_bytes() == ('project_id = "' + TARGET + '"\n').encode(), "minimal_project_config_required")


def snapshot_sql(cfg):
    # Only pg_catalog and native migration ledger metadata. Never invoke any of
    # the observed functions or select prosrc/body/SQL text in the result.
    wanted = [{"signature": r["signature"], "hashAlgorithm": r["bodyHashAlgorithm"]} for r in cfg["afterCatalog"]]
    spec = quote(json.dumps(wanted, separators=(",", ":")))
    return "\\set VERBOSITY sqlstate\nBEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s';\n" + f"""
WITH wanted AS (
  SELECT signature, "hashAlgorithm", to_regprocedure(signature)::oid AS function_oid
  FROM jsonb_to_recordset({spec}::jsonb) AS x(signature text,"hashAlgorithm" text)
), observed AS (
  SELECT w.signature, w."hashAlgorithm", p.* FROM wanted w
  LEFT JOIN pg_proc p ON p.oid=w.function_oid
)
SELECT json_build_object(
  'user', current_user, 'database', current_database(),
  'readOnly', current_setting('transaction_read_only'),
  'serverMajor', current_setting('server_version_num')::integer / 10000,
  'tls', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
  'versions', (SELECT coalesce(json_agg(json_build_object('version',version,'name',name) ORDER BY version),'[]') FROM supabase_migrations.schema_migrations),
  'functions', (SELECT json_agg(json_build_object(
    'signature', o.signature, 'exists', o.oid IS NOT NULL,
    'owner', (SELECT rolname FROM pg_roles WHERE oid=o.proowner),
    'securityDefiner', o.prosecdef, 'volatility', o.provolatile,
    'language', (SELECT lanname FROM pg_language WHERE oid=o.prolang),
    'returns', CASE WHEN o.oid IS NULL THEN NULL ELSE pg_get_function_result(o.oid) END,
    'kind', o.prokind, 'returnsSet', o.proretset,
    'config', o.proconfig,
    'acl', CASE WHEN o.oid IS NULL THEN NULL ELSE (SELECT json_agg(json_build_object(
      'grantee', CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE (SELECT rolname FROM pg_roles WHERE oid=a.grantee) END,
      'grantor', (SELECT rolname FROM pg_roles WHERE oid=a.grantor),
      'privilege', a.privilege_type, 'grantable', a.is_grantable)
      ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE (SELECT rolname FROM pg_roles WHERE oid=a.grantee) END,
      (SELECT rolname FROM pg_roles WHERE oid=a.grantor), a.privilege_type, a.is_grantable)
      FROM aclexplode(coalesce(o.proacl,acldefault('f',o.proowner))) a) END,
    'anonExecute', has_function_privilege('anon',o.oid,'EXECUTE'),
    'authenticatedExecute', has_function_privilege('authenticated',o.oid,'EXECUTE'),
    'serviceRoleExecute', has_function_privilege('service_role',o.oid,'EXECUTE'),
    'bodyHashAlgorithm', o."hashAlgorithm",
    'bodyHash', CASE WHEN o."hashAlgorithm"='md5' THEN md5(o.prosrc)
      ELSE encode(sha256(convert_to(o.prosrc,'UTF8')),'hex') END
  ) ORDER BY o.signature) FROM observed o)
);
ROLLBACK;
"""


def snapshot(cfg, host, user, password):
    ca_gate()
    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "PGHOST": host, "PGPORT": "5432", "PGUSER": user, "PGDATABASE": "postgres", "PGPASSWORD": password, "PGSSLMODE": "verify-full", "PGSSLROOTCERT": CA, "PGCONNECT_TIMEOUT": "10"}
    try:
        result = subprocess.run(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], env=env, input=snapshot_sql(cfg), capture_output=True, text=True, timeout=30)
        require(len(result.stdout) <= LIMIT and len(result.stderr) <= LIMIT, "read_only_snapshot_output_limit")
        if result.returncode != 0:
            raise Stop(snapshot_failure_code(result.stderr))
        records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        require(len(records) == 1 and isinstance(records[0], dict), "snapshot_shape_invalid")
        value = records[0]
        require(value.get("user") == "postgres" and value.get("database") == "postgres" and value.get("readOnly") == "on" and value.get("tls") is True and value.get("serverMajor") == 17, "snapshot_session_boundary_failed")
        return value
    except subprocess.TimeoutExpired:
        raise Stop("read_only_snapshot_timeout") from None
    except ValueError:
        raise Stop("read_only_snapshot_invalid_json") from None


def verify_snapshot(value, cfg, post=False, before=None):
    rows = value.get("versions")
    expected = cfg["after"] if post else cfg["before"]
    require(isinstance(rows, list) and all(isinstance(r, dict) and set(r) == {"version", "name"} and isinstance(r["version"], str) and isinstance(r["name"], str) for r in rows), "ledger_shape_invalid")
    require(rows == sorted(rows, key=lambda r: r["version"]) and len({r["version"] for r in rows}) == len(rows), "ledger_order_or_duplicate_failed")
    require(len(rows) == expected["count"] and rows[-1]["version"] == expected["latest"] and digest_versions(rows) == expected["versionsSha256"] and hashlib.sha256(canonical(rows)).hexdigest() == expected["versionNamesCanonicalJsonSha256"], "ledger_mismatch_stop_no_retry")
    require(value.get("functions") == (cfg["afterCatalog"] if post else cfg["beforeCatalog"]), "function_body_or_acl_mismatch_stop_no_retry")
    if post:
        require(isinstance(before, dict), "before_checkpoint_required")
        require(rows[:-1] == before["versions"] and rows[-1] == {"version": "20261004160000", "name": "legacy_effective_schedule_inheritance"}, "only_one_canonical_ledger_insert_required")
        writer = "dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)"
        prior = [r for r in before["functions"] if r["signature"] == writer]
        final = [r for r in value["functions"] if r["signature"] == writer]
        require(len(prior) == 1 and final == prior, "unchanged_august_writer_mismatch")


def safe_checkpoint(value):
    return {"ledgerCount": len(value["versions"]), "versionsSha256": digest_versions(value["versions"]), "versionNamesCanonicalJsonSha256": hashlib.sha256(canonical(value["versions"])).hexdigest(), "catalogSha256": hashlib.sha256(canonical(value["functions"])).hexdigest(), "readOnly": True, "tlsVerified": True}


def install_once(cfg, source, cli, host, user, password, receipt):
    require(cli.is_file() and not cli.is_symlink(), "pinned_cli_missing")
    source_gate(source, cfg)
    ca_gate()
    dsn = f"host={host} port=5432 user={user} dbname=postgres sslmode=verify-full sslrootcert={CA} connect_timeout=10"
    child_env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "PGPASSWORD": password, "SUPABASE_TELEMETRY_DISABLED": "1"}
    # Recheck after source/CA validation and immediately before the only push.
    # Expiry stops without invoking the CLI; it never resumes business writers.
    install_pause_gate(cfg, os.environ)
    receipt["phase"] = "one_pr97_canonical_push"
    # Native filename/version. No include-all, temporary SQL view, seed, vault,
    # role update, history repair, compensation or retry, including on timeout.
    result = command([str(cli), "db", "push", "--db-url", dsn, "--skip-vault", "--yes"], child_env, source, 600)
    receipt["cli"] = result
    success = result["exit"] == 0 and not result["timeout"] and not result["outputLimitExceeded"]
    if not success:
        receipt["phase"] = "failed_unknown_state_stop_no_retry"
        try:
            receipt["afterFailure"] = {**safe_checkpoint(snapshot(cfg, host, user, password)), "stateEquivalence": "unknown_stop_no_retry_or_repair"}
        except Stop:
            receipt["afterFailure"] = {"checkpoint": "unavailable_unknown_state_stop"}
        raise Stop("cli_failed_unknown_state_stop_no_retry")


def main():
    receipt = {"proposalOnly": True, "phase": "authority", "productionSuccess": False, "automaticRetry": False, "historyRepair": False}
    try:
        require(len(sys.argv) == 1, "runtime_arguments_forbidden")
        cfg = load_contract()
        mode = approval_gate(cfg, os.environ)
        receipt.update({"proposalOnly": False, "mode": mode, "sourceSha": SOURCE, "sqlSha256": SQL_SHA256, "contractSha256": CONTRACT_SHA256})
        workspace = pathlib.Path(os.environ["GITHUB_WORKSPACE"])
        source = workspace / "approved-source"
        require(workspace.is_absolute(), "workflow_workspace_invalid")
        receipt["phase"] = "source_ca_and_ci"
        source_gate(source, cfg)
        ca_gate()
        # Both modes require exact-source product CI; token remains read-only.
        ci_gate(cfg, os.environ["GH_TOKEN"])
        require(shutil.which("psql"), "psql_missing")
        receipt["phase"] = "read_only_target_and_before"
        host, user = endpoint(os.environ["SUPABASE_ACCESS_TOKEN"])
        before = snapshot(cfg, host, user, os.environ["SUPABASE_DB_PASSWORD"])
        verify_snapshot(before, cfg)
        receipt["before"] = safe_checkpoint(before)
        if mode == "preflight":
            receipt["readOnlyPreflightSuccess"] = True
            receipt["phase"] = "read_only_complete_no_cli_initialized"
        else:
            temp = pathlib.Path(os.environ["RUNNER_TEMP"])
            require(temp.is_absolute(), "workflow_temp_invalid")
            cli = temp / "inheritance-supabase-cli/supabase"
            install_once(cfg, source, cli, host, user, os.environ["SUPABASE_DB_PASSWORD"], receipt)
            receipt["phase"] = "read_only_after"
            after = snapshot(cfg, host, user, os.environ["SUPABASE_DB_PASSWORD"])
            verify_snapshot(after, cfg, post=True, before=before)
            source_gate(source, cfg)
            receipt["after"] = safe_checkpoint(after)
            receipt["productionSuccess"] = True
            receipt["phase"] = "only_pr97_ddl_and_canonical_ledger_verified"
    except Stop as error:
        receipt["failure"] = str(error)
    except Exception:
        receipt["failure"] = "unexpected_failure_unknown_state_stop_no_retry"
    pathlib.Path(SAFE_RECEIPT).write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))
    return 0 if receipt.get("productionSuccess") or receipt.get("readOnlyPreflightSuccess") else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--verify-ca-only"]:
        try:
            ca_gate()
        except Stop as error:
            print(str(error))
            sys.exit(1)
        except Exception:
            print("pinned_ca_verification_failed")
            sys.exit(1)
        print("pinned_public_ca_verified")
        sys.exit(0)
    if sys.argv[1:] == ["--verify-release-authority-only"]:
        try:
            approval_gate(load_contract(), os.environ, credentials=False)
        except Stop as error:
            print(str(error))
            sys.exit(1)
        except Exception:
            print("owner_authority_verification_failed")
            sys.exit(1)
        print("pinned_owner_authority_verified_no_credentials_or_network")
        sys.exit(0)
    def interrupted(_signum, _frame):
        raise Stop("interrupted_unknown_state_stop_no_retry")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
