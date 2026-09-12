/** Own disposable, socket-only PostgreSQL; no remote URL or shared DB accepted. */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { approvedSeedChanges } from "../src/features/public-content/server/content-routes.ts";
import { normalizeDraft } from "../src/features/public-content/content-contract.ts";
const exec = promisify(execFile);
const root = new URL("../", import.meta.url);
const docker =
  process.env.PUBLIC_CONTENT_QA_DOCKER ||
  "/Applications/Docker.app/Contents/Resources/bin/docker";
const name = `tips_content_qa_${randomUUID().slice(0, 8)}`;
const image = "public.ecr.aws/supabase/postgres:17.6.1.159";
const artifact = new URL("artifacts/public-content-20260912/", root);
const actor = "00000000-0000-4000-8000-000000000001";
const cases = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
function sql(query, databaseUser = "postgres") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      docker,
      [
        "exec",
        "-i",
        name,
        "psql",
        "-U",
        databaseUser,
        "-d",
        "postgres",
        "-X",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      errors = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(errors)),
    );
    child.stdin.end(query);
  });
}
const asAdmin = (query) =>
  `set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false); select set_config('content.fixture_role','admin',false); ${query}`;
const last = (value) => value.split("\n").at(-1);
const scalar = async (query) => last(await sql(query));
const save = (draft, id = randomUUID(), expectedVersion = 0) => ({
  id,
  expectedVersion,
  action: "save",
  entry: draft,
});
const reviewDraft = (options = {}) =>
  normalizeDraft({
    kind: "review",
    data: {
      name: "김*수",
      role: "학생",
      content: "격리 검증용 후기입니다.",
      ...options,
    },
    sortOrder: 0,
    isPublished: false,
  });
const rpc = (requestId, changes, bootstrap = false) =>
  `select public.apply_public_site_changes_v1('${requestId}',${literal(JSON.stringify(changes))}::jsonb,${bootstrap});`;
const apply = async (changes, requestId = randomUUID(), bootstrap = false) =>
  JSON.parse(await scalar(asAdmin(rpc(requestId, changes, bootstrap))));
const state = async (query) =>
  scalar(asAdmin(`select public.content_fixture_sqlstate(${literal(query)});`));
async function check(label, run) {
  await run();
  cases.push(label);
  console.log(`ok ${cases.length} - ${label}`);
}
try {
  await exec(docker, [
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=local_fixture_only",
    "-e",
    "PGDATA=/var/lib/postgresql/data",
    image,
    "postgres",
    "-D",
    "/var/lib/postgresql/data",
    "-c",
    "listen_addresses=",
  ]);
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      await exec(docker, ["exec", name, "pg_isready", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await pause(200);
    }
  }
  assert.ok(ready, "isolated database ready");
  await pause(700);
  // The postgres-only image has no Storage API migrations. These minimal tables
  // exercise bucket metadata and RLS DDL; signed binary uploads are separate QA.
  await sql(
    `create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text references storage.buckets(id));
    alter table storage.objects enable row level security;
    alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres;`,
    "supabase_admin",
  );
  await sql(`create function public.current_dashboard_role() returns text language sql stable as $$ select current_setting('content.fixture_role',true) $$;
    create function public.content_fixture_sqlstate(query text) returns text language plpgsql as $$ begin execute query;return '00000';exception when others then return SQLSTATE||':'||SQLERRM;end $$;`);
  await sql(
    await readFile(
      new URL(
        "supabase/migrations/20260912074228_public_site_content_management.sql",
        root,
      ),
      "utf8",
    ),
  );
  await check("migration applies to fresh Supabase PostgreSQL", async () =>
    assert.equal(
      await scalar("select count(*) from public.public_site_entries;"),
      "0",
    ),
  );
  await check(
    "private media bucket, explicit RLS and least privileges",
    async () => {
      assert.equal(
        await scalar(
          "select public=false and file_size_limit=41943040 from storage.buckets where id='public-site-media';",
        ),
        "t",
      );
      assert.equal(
        await scalar(
          "select relrowsecurity from pg_class where oid='public.public_site_entries'::regclass;",
        ),
        "t",
      );
      assert.equal(
        await scalar(
          "select has_column_privilege('anon','public.public_site_entries','data','SELECT') and not has_column_privilege('anon','public.public_site_entries','created_by','SELECT') and not has_table_privilege('authenticated','public.public_site_entries','INSERT') and not has_table_privilege('authenticated','public.public_site_write_receipts','SELECT');",
        ),
        "t",
      );
      assert.equal(
        await scalar(
          "select has_function_privilege('authenticated','public.apply_public_site_changes_v1(uuid,jsonb,boolean)','EXECUTE') and not has_function_privilege('anon','public.apply_public_site_changes_v1(uuid,jsonb,boolean)','EXECUTE');",
        ),
        "t",
      );
    },
  );
  await check("staff cannot invoke atomic gateway", async () => {
    const result = await scalar(
      `set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false);select set_config('content.fixture_role','staff',false);select public.content_fixture_sqlstate(${literal(rpc(randomUUID(), [save(reviewDraft())]))});`,
    );
    assert.match(result, /^42501:/);
  });
  const row = save(reviewDraft()),
    requestId = randomUUID();
  await check(
    "create returns version and identical request replays without duplicate",
    async () => {
      const created = await apply([row], requestId);
      assert.equal(created.applied, 1);
      assert.equal(created.entries[0].version, 1);
      assert.deepEqual(await apply([row], requestId), created);
      assert.equal(
        await scalar("select count(*) from public.public_site_entries;"),
        "1",
      );
      assert.match(
        await state(rpc(requestId, [save(reviewDraft())])),
        /^P0001:public_content_request_reused/,
      );
    },
  );
  await check(
    "anonymous hides drafts, admin reads drafts, staff sees none",
    async () => {
      assert.equal(
        await scalar(
          "set role anon;select count(id) from public.public_site_entries;",
        ),
        "0",
      );
      assert.equal(
        await scalar(
          asAdmin("select count(*) from public.public_site_entries;"),
        ),
        "1",
      );
      assert.equal(
        await scalar(
          "set role authenticated;select set_config('content.fixture_role','staff',false);select count(*) from public.public_site_entries;",
        ),
        "0",
      );
    },
  );
  await check(
    "publish, stale edit rejection and private author columns",
    async () => {
      await apply([save({ ...row.entry, isPublished: true }, row.id, 1)]);
      assert.equal(
        await scalar(
          "set role anon;select count(id) from public.public_site_entries;",
        ),
        "1",
      );
      assert.match(
        await state(rpc(randomUUID(), [save(row.entry, row.id, 1)])),
        /^P0001:public_content_version_conflict/,
      );
      assert.match(
        await scalar(
          `set role anon;select public.content_fixture_sqlstate('select created_by from public.public_site_entries');`,
        ),
        /^42501:/,
      );
    },
  );
  await check("batch error rolls back all writes and receipt", async () => {
    const id = randomUUID();
    const first = save(reviewDraft());
    const bad = {
      ...save(reviewDraft()),
      entry: {
        ...reviewDraft(),
        data: { ...reviewDraft().data, name: "홍길동" },
      },
    };
    assert.match(await state(rpc(id, [first, bad])), /^22023:/);
    assert.equal(
      await scalar(
        `select count(*) from public.public_site_entries where id='${first.id}';`,
      ),
      "0",
    );
    assert.equal(
      await scalar(
        `select count(*) from public.public_site_write_receipts where request_id='${id}';`,
      ),
      "0",
    );
  });
  await check(
    "SQL protects every display name and accepts original approved masks",
    async () => {
      for (const name of ["김*수, 홍길동", "홍길동(홍*동)", "홍길동ㅇ"]) {
        const draft = reviewDraft();
        draft.data.name = name;
        assert.match(await state(rpc(randomUUID(), [save(draft)])), /^22023:/);
      }
      for (const name of ["김ㅇ민", "김*수, 홍ㅇ동", "김*수 / 홍*동", "김*수 , 홍*동"]) {
        assert.equal((await apply([save(reviewDraft({ name }))])).applied, 1);
      }
    },
  );
  await check(
    "Korean 8000-character original and whitespace survive SQL",
    async () => {
      const content = "  " + "가".repeat(7995) + "\n  ";
      const accepted = save(reviewDraft({ content }));
      await apply([accepted]);
      assert.equal(
        await scalar(
          `select length(data->>'content')=8000 and data->>'content'=${literal(content)} from public.public_site_entries where id='${accepted.id}';`,
        ),
        "t",
      );
    },
  );
  await check(
    "malformed null, type and extra fields return invalid input",
    async () => {
      const malformed = [
        null,
        {},
        [null],
        [{ id: randomUUID(), expectedVersion: 0, action: null }],
        [{ ...save(reviewDraft()), entry: null }],
        [{ ...save(reviewDraft()), expectedVersion: null }],
        [
          {
            ...save(reviewDraft()),
            entry: { ...reviewDraft(), sortOrder: null },
          },
        ],
        [
          {
            ...save(reviewDraft()),
            entry: { ...reviewDraft(), isPublished: null },
          },
        ],
        [{ ...save(reviewDraft()), unexpected: true }],
      ];
      for (const changes of malformed)
        assert.match(
          await state(rpc(randomUUID(), changes)),
          /^22023:/,
          JSON.stringify(changes),
        );
    },
  );
  await check("concurrent creates serialize and exactly one wins", async () => {
    const change = save(reviewDraft());
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => state(rpc(randomUUID(), [change]))),
    );
    assert.equal(answers.filter((value) => value === "00000").length, 1);
    assert.equal(
      answers.filter((value) =>
        value.startsWith("P0001:public_content_version_conflict"),
      ).length,
      4,
    );
  });
  await check("concurrent edits serialize without lost updates", async () => {
    const change = save(reviewDraft());
    await apply([change]);
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        state(rpc(randomUUID(), [save(change.entry, change.id, 1)])),
      ),
    );
    assert.equal(answers.filter((value) => value === "00000").length, 1);
    assert.equal(
      answers.filter((value) =>
        value.startsWith("P0001:public_content_version_conflict"),
      ).length,
      4,
    );
    assert.equal(
      await scalar(
        `select version from public.public_site_entries where id='${change.id}';`,
      ),
      "2",
    );
  });
  await check(
    "delete checks current version and disappears publicly",
    async () => {
      await apply([{ id: row.id, expectedVersion: 2, action: "delete" }]);
      assert.equal(
        await scalar(
          `select count(*) from public.public_site_entries where id='${row.id}';`,
        ),
        "0",
      );
    },
  );
  await check(
    "bootstrap preserves all 3921 approved source records and retries atomically",
    async () => {
      const changes = approvedSeedChanges();
      assert.equal(changes.length, 3921);
      assert.match(
        await state(rpc(randomUUID(), changes, true)),
        /^P0001:public_content_bootstrap_not_empty/,
      );
      await sql(
        "truncate public.public_site_entries,public.public_site_write_receipts;",
      );
      const id = randomUUID();
      const result = await apply(changes, id, true);
      assert.equal(result.applied, 3921);
      assert.deepEqual(await apply(changes, id, true), result);
      assert.equal(
        await scalar(
          "select string_agg(kind||':'||n,',' order by kind) from (select kind,count(*) n from public.public_site_entries group by kind) counts;",
        ),
        "result:3804,review:110,teacher:7",
      );
      assert.equal(
        await scalar(
          "set role anon;select count(id) from public.public_site_entries;",
        ),
        "3921",
      );
      assert.equal(
        await scalar(
          "select count(*) from public.public_site_entries where kind='result';",
        ),
        "3804",
      );
    },
  );
  await mkdir(artifact, { recursive: true });
  const result = {
    ok: true,
    database: image,
    checks: cases,
    checkCount: cases.length,
    seed: { teacher: 7, review: 110, result: 3804 },
    remoteDatabaseContacted: false,
    realPersonalDataRead: false,
    roleResolver: "isolated fixture; production resolver unchanged",
  };
  await writeFile(
    new URL("database-results.json", artifact),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      checks: cases.length,
      remoteDatabaseContacted: false,
    }),
  );
} finally {
  await exec(docker, ["stop", name]).catch(() => {});
}
