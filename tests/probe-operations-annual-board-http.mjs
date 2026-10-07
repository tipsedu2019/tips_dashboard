import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Only the official isolated runner's new, disposable, schema-only DB is a target.
// No external provider, host HTTP publication, production URL, or installation is used.
export const POSTGREST_IMAGE = "public.ecr.aws/supabase/postgrest:v14.17";
export const POSTGREST_DIGEST = "sha256:c9dc201e555f5d8e37e7f39cdd4df0229774996e213bfd7de8d10ac609030f2c";
export const HTTP_YEAR = 2198;
const PREFIX = "a660";
const id = (group, ordinal) => `${PREFIX}${group}-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
export const HTTP_SCHOOL_ID = id("0000", 1);
export const HTTP_DETAIL_ID = id("2000", 1);
export const HTTP_ACTORS = Object.freeze(["viewer", "teacher", "assistant", "staff", "admin"].map((role, index) => ({ id: id("3000", index + 1), role })));
export const HTTP_CASES = Object.freeze([
  { start: "2198-10-06", meta: { rangeEnd: "2198-10-08" }, end: "2198-10-08" },
  { start: "2198-10-06", meta: { rangeEnd: "2198-10-06" }, end: "2198-10-06" },
  { start: "2198-10-06", meta: {}, end: "2198-10-06" },
  { start: "2198-10-06", meta: { rangeEnd: "2198-10-05" }, end: "2198-10-06" },
  { start: "2198-02-28", meta: { rangeEnd: "2198-02-30" }, end: "2198-02-28" },
  { start: "2198-09-30", meta: { rangeEnd: "2198-10-02" }, end: "2198-10-02" },
  { start: "2198-12-31", meta: { rangeEnd: "2199-01-02" }, end: "2199-01-02" },
  { start: "2198-10-06", meta: { rangeEnd: 21981008 }, end: "2198-10-06" },
  { start: "2198-10-06", meta: { rangeEnd: null }, end: "2198-10-06" },
  { start: "2198-10-06", meta: { rangeEnd: "2198-10-08" }, end: "2198-10-08", type: "수학시험일" },
  { start: "2198-10-06", meta: { rangeEnd: "2199-10-06" }, end: "2199-10-06" },
].map((entry, index) => ({ ...entry, id: id("1000", index + 1), ordinal: index + 1 })));

function requireCondition(condition, code) {
  if (!condition) throw new Error(`annual_http_${code}`);
}
const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
const ownershipHash = nonce => createHash("sha256").update(nonce).digest("hex");

export function ownedSidecarId(container, target, sidecarName, imageId) {
  requireCondition(/^[a-f0-9]{64}$/u.test(container.Id || "") && container.Name === `/${sidecarName}`
    && container.Config?.Labels?.["tips.isolated-db-qa"] === target.project
    && container.Config?.Labels?.["tips.annual-http-owner"] === ownershipHash(target.nonce)
    && container.Image === imageId, "sidecar_cleanup_owner_mismatch");
  return container.Id;
}

export function validateLocalTarget(env, config) {
  let url;
  try { url = new URL(env.TASK_LOCAL_DB_URL); } catch { requireCondition(false, "local_target_required"); }
  requireCondition(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1"
    && url.pathname === "/postgres" && url.username === "postgres" && url.password.length > 0
    && !url.search && !url.hash && /^\d{1,5}$/u.test(url.port)
    && Number(url.port) > 0 && Number(url.port) <= 65535, "local_target_required");
  const nonce = env.TASK_LOCAL_DB_NONCE || "";
  requireCondition(/^[a-f0-9]{32}$/u.test(nonce), "nonce_required");
  const projects = [...config.matchAll(/^project_id\s*=\s*"(tips_supabase_db_qa_[a-f0-9]{8,64})"\s*$/gmu)];
  const dbBlock = config.match(/^\[db\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/mu)?.[1];
  const ports = [...(dbBlock || "").matchAll(/^port\s*=\s*(\d+)\s*$/gmu)];
  requireCondition(projects.length === 1 && ports.length === 1 && Number(ports[0][1]) === Number(url.port), "config_target_mismatch");
  const project = projects[0][1];
  return { url, nonce, project, networkName: `${project}_internal`, container: `supabase_db_${project}` };
}

function one(value, code) {
  let rows;
  try { rows = JSON.parse(value); } catch { requireCondition(false, code); }
  requireCondition(Array.isArray(rows) && rows.length === 1 && rows[0] && typeof rows[0] === "object", code);
  return rows[0];
}

export function validateDockerBoundary(target, db, network, routes) {
  requireCondition(/^[a-f0-9]{64}$/u.test(db.Id || "") && db.Name === `/${target.container}` && db.State?.Running === true, "db_owner_mismatch");
  requireCondition(network.Name === target.networkName && /^[a-f0-9]{64}$/u.test(network.Id || "")
    && network.Internal === true && network.Driver === "bridge" && network.EnableIPv6 === false
    && network.Labels?.["tips.isolated-db-qa"] === target.project
    && network.Options?.["com.docker.network.bridge.host_binding_ipv4"] === "127.0.0.1", "internal_network_required");
  requireCondition(network.Containers && Object.keys(network.Containers).length === 1
    && network.Containers[db.Id]?.Name === target.container, "network_membership_mismatch");
  const networks = db.NetworkSettings?.Networks;
  requireCondition(networks && Object.keys(networks).length === 1 && networks[target.networkName]?.NetworkID === network.Id
    && [network.Id, target.networkName].includes(db.HostConfig?.NetworkMode), "db_network_mismatch");
  const requested = db.HostConfig.PortBindings;
  const published = db.NetworkSettings.Ports;
  requireCondition(requested && typeof requested === "object" && published && typeof published === "object", "db_ports_invalid");
  for (const [key, bindings] of Object.entries(requested)) {
    requireCondition(key === "5432/tcp" && Array.isArray(bindings) && bindings.length > 0
      && bindings.every(binding => ["", "127.0.0.1", "::1"].includes(binding.HostIp)
        && Number(binding.HostPort) === Number(target.url.port)), "db_ports_invalid");
  }
  for (const [key, bindings] of Object.entries(published)) {
    requireCondition(key === "5432/tcp" && Array.isArray(bindings)
      && bindings.every(binding => ["127.0.0.1", "::1"].includes(binding.HostIp)
        && Number(binding.HostPort) === Number(target.url.port)), "db_ports_invalid");
  }
  // The official runner supports an owned loopback relay when internal
  // bridges publish nothing: either {} or {"5432/tcp": []}. An empty entry
  // is accepted only with the exact requested test port; all real bindings
  // remain loopback-only. HTTP uses the independently verified internal sidecar.
  if (Object.hasOwn(published, "5432/tcp") && published["5432/tcp"].length === 0) {
    requireCondition(Object.keys(requested).length === 1 && Array.isArray(requested["5432/tcp"])
      && requested["5432/tcp"].length > 0, "db_ports_invalid");
  }
  requireCondition(Object.keys(requested).length <= 1 && Object.keys(published).length <= 1, "db_ports_invalid");
  const lines = String(routes).trim().split(/\r?\n/u);
  requireCondition(/^Iface\s+Destination\s+Gateway\s+Flags\b/u.test(lines[0] || "") && lines.length > 1, "route_invalid");
  for (const line of lines.slice(1)) {
    const [iface, destination, gateway, flags] = line.trim().split(/\s+/u);
    requireCondition(iface && /^[a-f0-9]{8}$/iu.test(destination || "") && /^[a-f0-9]{8}$/iu.test(gateway || "")
      && /^[a-f0-9]{4}$/iu.test(flags || ""), "route_invalid");
    requireCondition(destination !== "00000000" || !(parseInt(flags, 16) & 1), "default_route_forbidden");
  }
  const dbIp = networks[target.networkName].IPAddress;
  requireCondition(isIP(dbIp) === 4, "db_ip_invalid");
  return { networkId: network.Id, dbIp };
}

export function validateSidecarBoundary(target, sidecar, { sidecarId, sidecarName, imageId, networkId, dbId, network }) {
  const networks = sidecar.NetworkSettings?.Networks;
  const requested = sidecar.HostConfig?.PortBindings;
  const published = sidecar.NetworkSettings?.Ports;
  requireCondition(sidecar.Id === sidecarId && sidecar.Name === `/${sidecarName}` && sidecar.State?.Running === true
    && sidecar.Config?.Labels?.["tips.isolated-db-qa"] === target.project
    && sidecar.Config?.Labels?.["tips.annual-http-owner"] === ownershipHash(target.nonce)
    && sidecar.HostConfig?.ReadonlyRootfs === true && sidecar.Image === imageId
    && sidecar.HostConfig.CapDrop?.includes("ALL")
    && sidecar.HostConfig.SecurityOpt?.some(value => /^no-new-privileges(?::true)?$/u.test(value))
    && !sidecar.HostConfig.Privileged && (!sidecar.HostConfig.Binds || sidecar.HostConfig.Binds.length === 0)
    && Array.isArray(sidecar.Mounts) && sidecar.Mounts.every(mount => mount.Type === "tmpfs" && mount.Destination === "/tmp")
    && requested && typeof requested === "object" && !Array.isArray(requested) && Object.keys(requested).length === 0
    && published && typeof published === "object" && !Array.isArray(published) && Object.values(published).every(bindings => bindings === null)
    && networks && Object.keys(networks).length === 1 && networks[target.networkName]?.NetworkID === networkId
    && [networkId, target.networkName].includes(sidecar.HostConfig.NetworkMode), "sidecar_boundary_invalid");
  requireCondition(network.Id === networkId && network.Name === target.networkName && network.Internal === true
    && network.Labels?.["tips.isolated-db-qa"] === target.project
    && network.Containers && Object.keys(network.Containers).length === 2
    && network.Containers[dbId]?.Name === target.container && network.Containers[sidecarId]?.Name === sidecarName,
  "sidecar_network_membership_mismatch");
  // Docker supplies no external gateway to this sole --internal bridge. The
  // DB's actual route table was also checked; the minimal PostgREST image needs
  // no shell/debug image or broader network solely to inspect its namespace.
  const ip = networks[target.networkName].IPAddress;
  requireCondition(isIP(ip) === 4, "sidecar_ip_invalid");
  return ip;
}

export function signSyntheticJwt(secret, claims) {
  requireCondition(/^[a-f0-9]{32}$/u.test(secret), "nonce_required");
  const encoded = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded(claims)}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

export function buildFixtureSql() {
  const actorValues = HTTP_ACTORS.map(actor => `(${sqlLiteral(actor.id)}::uuid,${sqlLiteral(actor.role)})`).join(",");
  const ids = HTTP_ACTORS.map(actor => sqlLiteral(actor.id)).join(",");
  const eventValues = HTTP_CASES.map(entry => `(${sqlLiteral(entry.id)}::uuid,${sqlLiteral(`__annual_http_case_${entry.ordinal}__`)},${sqlLiteral(HTTP_SCHOOL_ID)}::uuid,${sqlLiteral(entry.type || "시험기간")},${sqlLiteral(entry.start)}::date,'중2',${sqlLiteral(`synthetic HTTP fixture\n\n[[TIPS_META]] ${JSON.stringify(entry.meta)}`)})`).join(",\n");
  return `begin;
set local statement_timeout='30s'; set local lock_timeout='5s';
do $guard$ begin
  if current_database() <> 'postgres' or exists(select 1 from auth.users where id in (${ids}))
    or exists(select 1 from public.profiles where id in (${ids}))
    or exists(select 1 from public.academic_schools where id=${sqlLiteral(HTTP_SCHOOL_ID)}::uuid)
    or exists(select 1 from public.academic_events where id in (${HTTP_CASES.map(entry => sqlLiteral(entry.id)).join(",")}))
    or exists(select 1 from public.academic_event_exam_details where id=${sqlLiteral(HTTP_DETAIL_ID)}::uuid)
  then raise exception 'annual_http_fixture_collision'; end if;
end $guard$;
insert into auth.users(id) select actor_id from (values ${actorValues}) as actors(actor_id,role);
insert into public.profiles(id,role) select actor_id,role from (values ${actorValues}) as actors(actor_id,role)
on conflict(id) do update set role=excluded.role;
set local request.jwt.claims=${sqlLiteral(JSON.stringify({ sub: HTTP_ACTORS[4].id, role: "authenticated" }))};
set local request.jwt.claim.sub=${sqlLiteral(HTTP_ACTORS[4].id)};
insert into public.academic_schools(id,name,category) values(${sqlLiteral(HTTP_SCHOOL_ID)}::uuid,'__annual_http_synthetic__','middle');
insert into public.academic_events(id,title,school_id,type,date,grade,note) values ${eventValues};
insert into public.academic_event_exam_details(id,academic_event_id,school_id,grade,subject,exam_date,exam_date_status,sort_order)
values(${sqlLiteral(HTTP_DETAIL_ID)}::uuid,${sqlLiteral(HTTP_CASES[0].id)}::uuid,${sqlLiteral(HTTP_SCHOOL_ID)}::uuid,'중2','수학','2198-10-07','exact',0);
commit;
select 'ANNUAL_HTTP_SQL:' || jsonb_build_object('seeded',true)::text;
`;
}

const FINGERPRINT_SQL = `select 'ANNUAL_HTTP_SQL:' || jsonb_build_object(
  'database', current_database(),
  'authenticatorCanLogin', (select rolcanlogin from pg_roles where rolname='authenticator'),
  'authenticatorSuperuser', (select rolsuper from pg_roles where rolname='authenticator'),
  'storage', md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(e) order by e.id) from public.academic_events e where school_id='${HTTP_SCHOOL_ID}'),
    (select jsonb_agg(to_jsonb(s) order by s.id) from public.academic_schools s where id='${HTTP_SCHOOL_ID}'),
    (select jsonb_agg(to_jsonb(d) order by d.id) from public.academic_event_exam_details d where school_id='${HTTP_SCHOOL_ID}'),
    (select jsonb_agg(jsonb_build_array(p.id,p.role) order by p.id) from public.profiles p where id in (${HTTP_ACTORS.map(actor => sqlLiteral(actor.id)).join(",")})),
    (select jsonb_agg(u.id order by u.id) from auth.users u where id in (${HTTP_ACTORS.map(actor => sqlLiteral(actor.id)).join(",")}))
  )::text),
  'security', (select md5(coalesce(jsonb_agg(to_jsonb(objects) order by kind,identity)::text,'[]')) from (
    select 'relation' kind,c.oid::regclass::text identity,jsonb_build_array(c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) definition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','dashboard_private','auth')
    union all select 'function',p.oid::regprocedure::text,jsonb_build_array(pg_get_functiondef(p.oid),p.proacl,p.proowner,p.prosecdef,p.proconfig)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','dashboard_private','auth') and p.prokind in ('f','p')
    union all select 'policy',polrelid::regclass::text||'.'||polname,jsonb_build_array(polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid))
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','dashboard_private','auth')
  ) objects)
)::text;`;

export function assertAnnualContract(body) {
  requireCondition(body?.ok === true && body.data?.academicYear === HTTP_YEAR && Array.isArray(body.data.rows), "rpc_shape_invalid");
  const rows = body.data.rows.filter(row => row.schoolId === HTTP_SCHOOL_ID);
  const entries = rows.flatMap(row => Object.values(row.typeBuckets || {}).flat());
  requireCondition(entries.length === HTTP_CASES.length + 1, "entry_count_mismatch");
  const dates = [];
  for (const expected of HTTP_CASES) {
    const matches = entries.filter(entry => entry.id === expected.id);
    requireCondition(matches.length === 1, "entry_missing");
    const entry = matches[0];
    const label = expected.start === expected.end ? expected.start : `${expected.start} ~ ${expected.end}`;
    const metadataEnd = expected.meta.rangeEnd == null ? undefined : String(expected.meta.rangeEnd);
    requireCondition(entry.start === expected.start && entry.end === expected.end && entry.dateLabel === label
      && entry.displayMeta?.rangeEnd === metadataEnd, "inclusive_period_mismatch");
    dates.push({ case: expected.ordinal, start: entry.start, end: entry.end, dateLabel: entry.dateLabel, rangeEnd: entry.displayMeta?.rangeEnd ?? null });
  }
  const details = entries.filter(entry => entry.id === `exam-detail:${HTTP_DETAIL_ID}`);
  requireCondition(details.length === 1 && details[0].start === "2198-10-07" && details[0].end === "2198-10-07"
    && details[0].dateLabel === "2198-10-07" && details[0].examDateLabel === "2198-10-07"
    && details[0].displayMeta?.rangeEnd === "2198-10-08", "subject_detail_mismatch");
  return { dates, independentDetail: { start: details[0].start, end: details[0].end, dateLabel: details[0].dateLabel, rangeEnd: details[0].displayMeta.rangeEnd } };
}

async function execute(args, { input = "", extraEnv = {}, allowFailure = false } = {}) {
  // Secrets are supplied on stdin or as inherited env values, never argv or output.
  const child = spawn("docker", args, { env: { ...process.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
  const chunks = [];
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("annual_http_child_timeout")); }, 45_000);
    child.stdout.on("data", chunk => { chunks.push(chunk); });
    child.stderr.on("data", () => {}); // Docker/PostgREST diagnostics may contain URI; never forward them.
    child.on("error", () => { clearTimeout(timer); reject(new Error("annual_http_child_failed")); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
  requireCondition(allowFailure || result.code === 0, "child_failed");
  return result;
}

export async function runAnnualHttpProbe({ env = process.env, config = null } = {}) {
  const target = validateLocalTarget(env, config ?? await readFile("supabase/config.toml", "utf8"));
  requireCondition(!env.DOCKER_HOST || env.DOCKER_HOST.startsWith("unix:///"), "local_docker_required");
  const endpoint = (await execute(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"])).stdout.trim();
  let endpointUrl;
  try { endpointUrl = JSON.parse(endpoint); } catch { requireCondition(false, "local_docker_required"); }
  requireCondition(typeof endpointUrl === "string" && endpointUrl.startsWith("unix:///"), "local_docker_required");
  const db = one((await execute(["inspect", "--type", "container", target.container])).stdout, "db_inspect_invalid");
  const network = one((await execute(["network", "inspect", target.networkName])).stdout, "network_inspect_invalid");
  const route = (await execute(["exec", target.container, "cat", "/proc/net/route"])).stdout;
  const boundary = validateDockerBoundary(target, db, network, route);
  const image = one((await execute(["image", "inspect", POSTGREST_IMAGE])).stdout, "cached_image_required");
  requireCondition(/^sha256:[a-f0-9]{64}$/u.test(image.Id || "") && image.Os === "linux" && ["amd64", "arm64"].includes(image.Architecture)
    && image.RepoTags?.includes(POSTGREST_IMAGE) && image.RepoDigests?.some(value => value === `public.ecr.aws/supabase/postgrest@${POSTGREST_DIGEST}`), "cached_image_digest_mismatch");
  const sidecarOwner = ownershipHash(target.nonce);
  const sidecarName = `tips_annual_http_${target.project.slice("tips_supabase_db_qa_".length)}_${sidecarOwner.slice(0, 12)}`;
  const existing = await execute(["ps", "--all", "--filter", `name=^/${sidecarName}$`, "--format", "{{.ID}}"]);
  requireCondition(existing.stdout.trim() === "", "sidecar_already_exists");
  const query = async sql => {
    const result = await execute(["exec", "-i", target.container, "psql", "-XqAt", "--set", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql });
    const line = result.stdout.trim().split(/\r?\n/u).find(value => value.startsWith("ANNUAL_HTTP_SQL:"));
    requireCondition(line, "sql_frame_missing");
    try { return JSON.parse(line.slice("ANNUAL_HTTP_SQL:".length)); } catch { requireCondition(false, "sql_frame_invalid"); }
  };
  // HTTP uses a separate connection, so commit only fresh synthetic rows. The
  // official runner destroys this owned database in its outer finally block.
  const catalogBeforeSeed = await query(FINGERPRINT_SQL);
  requireCondition(catalogBeforeSeed.database === "postgres" && catalogBeforeSeed.authenticatorCanLogin === true
    && catalogBeforeSeed.authenticatorSuperuser === false, "authenticator_role_invalid");
  requireCondition((await query(buildFixtureSql())).seeded === true, "seed_failed");
  const before = await query(FINGERPRINT_SQL);
  requireCondition(before.security === catalogBeforeSeed.security, "seed_changed_security");
  let sidecarId = null;
  let createAttempted = false;
  let primaryError = null;
  let summary;
  try {
    const dbUri = new URL(target.url);
    dbUri.username = "authenticator";
    dbUri.hostname = boundary.dbIp;
    dbUri.port = "5432";
    createAttempted = true;
    const created = await execute(["create", "--pull=never", "--name", sidecarName, "--network", boundary.networkId,
      "--read-only", "--cap-drop=ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--label", `tips.isolated-db-qa=${target.project}`, "--label", `tips.annual-http-owner=${sidecarOwner}`,
      "--env", "PGRST_DB_URI", "--env", "PGRST_JWT_SECRET", "--env", "PGRST_DB_SCHEMAS=public", "--env", "PGRST_DB_ANON_ROLE=anon",
      "--env", "PGRST_SERVER_PORT=3000", "--env", "PGRST_LOG_LEVEL=crit", image.Id],
    { extraEnv: { PGRST_DB_URI: dbUri.href, PGRST_JWT_SECRET: target.nonce } });
    sidecarId = created.stdout.trim();
    requireCondition(/^[a-f0-9]{64}$/u.test(sidecarId), "sidecar_create_invalid");
    await execute(["start", sidecarId]);
    const sidecar = one((await execute(["inspect", "--type", "container", sidecarId])).stdout, "sidecar_inspect_invalid");
    const sidecarNetwork = one((await execute(["network", "inspect", target.networkName])).stdout, "network_inspect_invalid");
    const sidecarIp = validateSidecarBoundary(target, sidecar, { sidecarId, sidecarName, imageId: image.Id,
      networkId: boundary.networkId, dbId: db.Id, network: sidecarNetwork });
    const http = async (path, { token = null, body = {}, method = "POST" } = {}) => {
      requireCondition(path.startsWith("/rpc/") || path.startsWith("/profiles?") || path.startsWith("/academic_events?"), "http_path_invalid");
      const settings = [`url = ${JSON.stringify(`http://${sidecarIp}:3000${path}`)}`, `request = ${JSON.stringify(method)}`,
        'header = "Content-Type: application/json"', 'silent', 'show-error', 'noproxy = "*"', 'connect-timeout = 2', 'max-time = 15',
        'write-out = "\\nANNUAL_HTTP_STATUS:%{http_code}\\n"'];
      if (token) settings.push(`header = ${JSON.stringify(`Authorization: Bearer ${token}`)}`);
      if (method === "POST") settings.push(`data = ${JSON.stringify(JSON.stringify(body))}`);
      const result = await execute(["exec", "-i", target.container, "curl", "--config", "-"], { input: `${settings.join("\n")}\n`, allowFailure: true });
      const at = result.stdout.lastIndexOf("\nANNUAL_HTTP_STATUS:");
      requireCondition(result.code === 0 && at >= 0, "http_transport_failed");
      let parsed;
      try { parsed = JSON.parse(result.stdout.slice(0, at)); } catch { requireCondition(false, "http_body_invalid"); }
      return { status: Number(result.stdout.slice(at).trim().split(":")[1]), body: parsed };
    };
    const annual = options => http("/rpc/get_operations_annual_board_v1", { body: { p_academic_year: HTTP_YEAR }, ...options });
    let anon;
    const readyUntil = Date.now() + 25_000;
    while (Date.now() < readyUntil) {
      try { anon = await annual({}); if ([401, 403].includes(anon.status) && anon.body?.code === "42501") break; } catch { /* wait for owned sidecar only */ }
      await delay(250);
    }
    requireCondition(anon && [401, 403].includes(anon.status) && anon.body?.code === "42501", "anonymous_contract_mismatch");
    const now = Math.floor(Date.now() / 1000);
    const tokenFor = actor => signSyntheticJwt(target.nonce, { role: "authenticated", sub: actor.id, iat: now, exp: now + 300 });
    const roleEvidence = [];
    let dateEvidence;
    for (const actor of HTTP_ACTORS) {
      const token = tokenFor(actor);
      const profile = await http(`/profiles?id=eq.${actor.id}&select=id,role`, { token, method: "GET" });
      requireCondition(profile.status === 200 && Array.isArray(profile.body) && profile.body.length === 1
        && profile.body[0].id === actor.id && profile.body[0].role === actor.role, "profile_identity_mismatch");
      const resolved = await http("/rpc/current_dashboard_role", { token });
      requireCondition(resolved.status === 200 && resolved.body === actor.role, "profile_role_mismatch");
      const response = await annual({ token });
      requireCondition(response.status === 200, "authenticated_status_mismatch");
      const projected = assertAnnualContract(response.body);
      requireCondition(!dateEvidence || JSON.stringify(projected) === JSON.stringify(dateEvidence), "role_scope_mismatch");
      dateEvidence = projected;
      const future = await annual({ token, body: { p_academic_year: HTTP_YEAR + 1 } });
      requireCondition(future.status === 200 && future.body?.ok === true && !future.body.data.rows.some(row => row.schoolId === HTTP_SCHOOL_ID), "start_year_filter_mismatch");
      roleEvidence.push({ role: actor.role, status: response.status, profileUidMatched: true, databaseRoleMatched: true, entries: HTTP_CASES.length + 1 });
    }
    const rejected = [];
    const wrongSigningKey = `${target.nonce[0] === "0" ? "1" : "0"}${target.nonce.slice(1)}`;
    for (const [caseName, options, status, code, message] of [
      ["malformed-jwt", { token: "malformed.synthetic.jwt" }, 401, null, null],
      ["wrong-signature", { token: signSyntheticJwt(wrongSigningKey, { role: "authenticated", sub: HTTP_ACTORS[0].id, exp: now + 300 }) }, 401, "PGRST301", null],
      ["expired-jwt", { token: signSyntheticJwt(target.nonce, { role: "authenticated", sub: HTTP_ACTORS[0].id, exp: now - 3600 }) }, 401, null, null],
      ["missing-uid", { token: signSyntheticJwt(target.nonce, { role: "authenticated", exp: now + 300 }) }, 403, "42501", "science_subject_areas_authentication_required"],
      ["invalid-year", { token: tokenFor(HTTP_ACTORS[0]), body: { p_academic_year: 1999 } }, 400, "22023", "operations_academic_year_invalid"],
      ["invalid-upper-year", { token: tokenFor(HTTP_ACTORS[0]), body: { p_academic_year: 2201 } }, 400, "22023", "operations_academic_year_invalid"],
    ]) {
      const result = await annual(options);
      requireCondition(result.status === status && (!code || result.body?.code === code)
        && (!message || result.body?.message === message), "rejection_contract_mismatch");
      requireCondition(code || ["PGRST301", "PGRST303"].includes(result.body?.code), "jwt_error_code_mismatch");
      rejected.push({ case: caseName, status: result.status, code: result.body.code });
    }
    const anonRows = await http(`/academic_events?school_id=eq.${HTTP_SCHOOL_ID}&select=id`, { method: "GET" });
    requireCondition(anonRows.status === 200 && Array.isArray(anonRows.body) && anonRows.body.length === 0, "anonymous_rls_mismatch");
    const after = await query(FINGERPRINT_SQL);
    requireCondition(before.storage === after.storage && before.security === after.security, "reads_changed_storage_or_security");
    summary = { status: "passed", probe: "operations-annual-board-http", transport: "signed-JWT/PostgREST/current-RPC",
      officialImage: POSTGREST_IMAGE, imageDigest: POSTGREST_DIGEST, imageId: image.Id, imageArchitecture: image.Architecture,
      internalNetwork: true, hostHttpPorts: 0,
      roles: roleEvidence, anonymous: { status: anon.status, code: anon.body.code, visibleBaseEvents: 0 }, rejected,
      actualDateProjection: dateEvidence, storageUnchangedByReads: true, rlsAclUnchanged: true, providerCalls: 0 };
  } catch (error) { primaryError = error; }
  finally {
    let cleanupFailed = false;
    // A failed/uncertain `create` can still have created the exact fresh name.
    // Recover ownership from its labels+image before any removal; never sweep.
    if (createAttempted && !/^[a-f0-9]{64}$/u.test(sidecarId || "")) {
      sidecarId = null;
      try {
        const present = await execute(["ps", "--all", "--filter", `name=^/${sidecarName}$`, "--format", "{{.ID}}"]);
        if (present.stdout.trim()) {
          const recovered = await execute(["inspect", "--type", "container", sidecarName]);
          sidecarId = ownedSidecarId(one(recovered.stdout, "sidecar_inspect_invalid"), target, sidecarName, image.Id);
        }
      } catch { cleanupFailed = true; }
    }
    if (sidecarId && /^[a-f0-9]{64}$/u.test(sidecarId)) {
      try {
        const removed = await execute(["rm", "--force", sidecarId], { allowFailure: true });
        cleanupFailed ||= removed.code !== 0;
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) primaryError = new Error(primaryError ? "annual_http_probe_and_sidecar_cleanup_failed" : "annual_http_sidecar_cleanup_failed");
  }
  if (primaryError) throw primaryError;
  summary.sidecarCleanup = "succeeded";
  return summary;
}

// macOS /tmp and /var aliases must not let a staged --probe silently skip main.
const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entryPath && entryPath === await realpath(fileURLToPath(import.meta.url))) {
  runAnnualHttpProbe().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    // Only static probe codes are printable. Never print child output, tokens, URI or stack.
    process.stderr.write(`${/^annual_http_[a-z_]+$/u.test(error?.message || "") ? error.message : "annual_http_probe_failed"}\n`);
    process.exitCode = 1;
  });
}
