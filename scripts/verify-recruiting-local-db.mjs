/** Creates its own socket-only disposable PostgreSQL; never accepts a remote URL. */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const root = new URL("../", import.meta.url);
const name = `tips_recruiting_qa_${randomUUID().slice(0, 8)}`;
const artifact = new URL("artifacts/recruiting-20260911/", root);
const image = "public.ecr.aws/supabase/postgres:17.6.1.159";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function sql(query, databaseUser = "postgres") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", name, "psql", "-U", databaseUser, "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", errors = "";
    child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(errors)));
    child.stdin.end(query);
  });
}
try {
  await exec("docker", ["run", "--rm", "-d", "--name", name, "-e", "POSTGRES_PASSWORD=local_fixture_only", "-e", "PGDATA=/var/lib/postgresql/data", image, "postgres", "-D", "/var/lib/postgresql/data", "-c", "shared_preload_libraries=pg_cron", "-c", "cron.database_name=postgres", "-c", "cron.use_background_workers=on", "-c", "listen_addresses="]);
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await exec("docker", ["exec", name, "pg_isready", "-U", "postgres"]); ready = true; break; } catch { await pause(200); }
  }
  assert.ok(ready, "local database ready");
  // Await final post-init server, not the entrypoint's temporary server.
  await pause(500);
  await sql("create extension if not exists pg_cron; grant usage on schema cron to postgres; grant select on all tables in schema cron to postgres;", "supabase_admin");
  await sql(`create extension if not exists pgtap;
    create function public.current_dashboard_role() returns text language sql stable as $$select current_setting('recruiting.fixture_role',true)$$;`);
  await sql(await readFile(new URL("supabase/migrations/20260911102816_recruiting_applications_private_intake.sql", root), "utf8"));
  await sql(`create function public.recruiting_fixture_submit(p_id uuid, p_contact text default 'contact', p_ip text default 'ip', p_hash text default 'same') returns jsonb language sql as $$
    select public.submit_recruiting_application_v1(p_id, repeat(md5(p_hash),2), repeat(md5(p_ip),2), repeat(md5(p_contact),2), repeat(md5('global'),2), '모의 지원자', '01000000000', '과학', '모의 경력', '실제 지원서가 아닌 모의 지원 동기입니다.', null, 'talent-pool-v1',365)$$;`);
  assert.equal(await sql("select count(*) from cron.job where jobname='recruiting-retention-cleanup';"), "0", "migration does not activate cron");
  assert.equal(await sql("select count(*) from public.recruiting_retention_status;"), "0", "migration does not run the initial purge");
  const beforeActivation = await sql(`set role service_role; select public.recruiting_fixture_submit('${randomUUID()}')->>'status';`);
  assert.equal(beforeActivation.split("\n").at(-1), "unavailable", "intake is closed before operational activation");
  assert.equal(await sql("select count(*) from public.recruiting_applications;"), "0", "closed intake stores nothing");
  const activation = await readFile(new URL("scripts/operations/activate-recruiting-retention.sql", root), "utf8");
  await sql(activation);
  await sql(activation);
  assert.equal(await sql("select count(*) from cron.job where jobname='recruiting-retention-cleanup' and active and schedule='13 * * * *';"), "1", "explicit activation retries preserve one hourly job");
  assert.equal(await sql("select last_succeeded_at > now() - interval '1 minute' from public.recruiting_retention_status;"), "t", "explicit activation initializes cleanup health");
  const tap = await sql(await readFile(new URL("tests/recruiting-database.test.sql", root), "utf8"));
  assert.equal(/^not ok /m.test(tap), false, tap); assert.equal((tap.match(/^ok /gm) || []).length, 39, tap);
  const requestId = randomUUID();
  const duplicate = await Promise.all(Array.from({ length: 8 }, () => sql(`set role service_role; select public.recruiting_fixture_submit('${requestId}');`)));
  const receipts = duplicate.map((result) => JSON.parse(result.split("\n").at(-1)));
  assert.ok(receipts.every((result) => result.status === "accepted")); assert.equal(new Set(receipts.map((result) => result.applicationId)).size, 1);
  assert.equal(await sql("select count(*) from public.recruiting_applications;"), "1");
  const raced = await Promise.all(Array.from({ length: 10 }, (_, n) => sql(`set role service_role; select public.recruiting_fixture_submit('${randomUUID()}', 'concurrent-contact-${n}', 'concurrent-ip');`)));
  assert.equal(raced.filter((result) => JSON.parse(result.split("\n").at(-1)).status === "accepted").length, 5);
  // Exercise the actual extension's background worker, not a fake scheduler.
  await sql(`update public.recruiting_applications set consented_at=now()-interval '400 days', expires_at=now()-interval '35 days';
    update public.recruiting_application_receipts set expires_at=now()-interval '35 days';
    update public.recruiting_retention_status set last_succeeded_at=now()-interval '4 hours';
    select cron.schedule('recruiting-retention-cleanup','1 second','select public.purge_expired_recruiting_applications_v1();');`);
  let purged = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await sql("select (select count(*)=0 from public.recruiting_applications) and (select last_succeeded_at>now()-interval '1 minute' from public.recruiting_retention_status);") === "t") { purged = true; break; }
    await pause(250);
  }
  assert.ok(purged, "actual pg_cron worker purges expired rows and updates health");
  const jobs = await sql("select status from cron.job_run_details where jobid=(select jobid from cron.job where jobname='recruiting-retention-cleanup') order by runid desc limit 1;");
  assert.equal(jobs, "succeeded");
  await mkdir(artifact, { recursive: true });
  await writeFile(new URL("database-pgtap.txt", artifact), `${tap}\n`);
  const result = { ok: true, database: image, migrationSchedulesOrPurges: false, intakeClosedBeforeActivation: true, explicitActivationRetries: 2, activationJobCount: 1, pgTapAssertions: 39, concurrentDuplicateRequests: 8, duplicateApplicationsStored: 1, concurrentIpRequests: 10, concurrentIpAccepted: 5, realPgCronWorker: jobs, remoteDatabaseContacted: false, roleResolver: "isolated fixture; existing production resolver unchanged" };
  await writeFile(new URL("database-results.json", artifact), `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result, null, 2));
} finally { await exec("docker", ["stop", name]).catch(() => {}); }
