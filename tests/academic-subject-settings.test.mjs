import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const migrationUrl = new URL(
  "../supabase/migrations/20260722090000_academic_subject_foundation.sql",
  import.meta.url,
);
const pgTapUrl = new URL(
  "../supabase/tests/academic_subject_foundation_test.sql",
  import.meta.url,
);
const serviceSourceUrl = new URL(
  "../src/features/management/academic-subject-settings-service.ts",
  import.meta.url,
);

const allGrades = [
  "초1", "초2", "초3", "초4", "초5", "초6",
  "중1", "중2", "중3", "고1", "고2", "고3",
];

function validRows() {
  const now = "2026-07-22T00:00:00.000Z";
  return [
    {
      subject: "영어",
      is_active: true,
      registration_create_enabled: true,
      grade_levels: allGrades,
      default_director_profile_id: null,
      sort_order: 10,
      created_at: now,
      updated_at: now,
    },
    {
      subject: "수학",
      is_active: true,
      registration_create_enabled: true,
      grade_levels: allGrades,
      default_director_profile_id: null,
      sort_order: 20,
      created_at: now,
      updated_at: now,
    },
    {
      subject: "과학",
      is_active: true,
      registration_create_enabled: true,
      grade_levels: ["고1", "고2", "고3"],
      default_director_profile_id: "22222222-2222-4222-8222-222222222222",
      sort_order: 30,
      created_at: now,
      updated_at: now,
    },
  ];
}

async function loadServiceFactory() {
  const source = await readFile(serviceSourceUrl, "utf8");
  const startMarker = "// academic-subject-settings-service-factory:start";
  const endMarker = "// academic-subject-settings-service-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  assert.notEqual(start, -1, "settings service factory start marker must exist");
  assert.ok(end > start, "settings service factory end marker must follow start marker");

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createAcademicSubjectSettingsService };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };

  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
  });
  return sandboxModule.exports;
}

function createClient(results) {
  const queue = [...results];
  const calls = [];
  return {
    calls,
    client: {
      rpc(name, args) {
        calls.push({ name, args });
        assert.ok(queue.length > 0, "unexpected settings RPC call");
        return queue.shift();
      },
    },
  };
}

function plainSetting(row) {
  return {
    subject: row.subject,
    isActive: row.isActive,
    registrationCreateEnabled: row.registrationCreateEnabled,
    gradeLevels: [...row.gradeLevels],
    defaultDirectorProfileId: row.defaultDirectorProfileId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

test("the forward migration defines the subject settings, science areas, and capability RPC", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create table public\.academic_subject_settings/i);
  assert.match(sql, /subject in \('영어', '수학', '과학'\)/i);
  assert.match(sql, /array\['고1', '고2', '고3'\]/i);
  assert.match(sql, /create table public\.academic_subject_areas/i);
  assert.match(
    sql,
    /integrated_science[\s\S]*physics[\s\S]*chemistry[\s\S]*life_science[\s\S]*earth_science/i,
  );
  assert.match(sql, /list_registration_subject_capabilities_v1/i);
  assert.match(
    sql,
    /join public\.teacher_catalogs as teacher[\s\S]*teacher\.profile_id = profile\.id/i,
  );
  assert.match(sql, /teacher\.is_visible = true/i);
  assert.match(sql, /account\.deleted_at is null/i);
  assert.match(sql, /account\.banned_until is null[\s\S]*account\.banned_until <= pg_catalog\.now\(\)/i);
  assert.match(sql, /when '과학' then '과학팀' = any\(teacher\.subjects\)/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(
    sql,
    /revoke all on table public\.academic_subject_settings[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.update_academic_subject_setting_v1\(text, boolean, boolean, text\[\], uuid\)[\s\S]*to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /create(?: or replace)? function public\.registration_subject_tracks_runtime_version/i,
  );
});

test("capability reads revalidate a stored director and pgTAP covers hidden banned and deleted accounts", async () => {
  const [sql, pgTap] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(pgTapUrl, "utf8"),
  ]);
  const listRpc = sql.slice(
    sql.indexOf("create or replace function public.list_registration_subject_capabilities_v1"),
    sql.indexOf("create or replace function public.update_academic_subject_setting_v1"),
  );

  assert.match(
    listRpc,
    /dashboard_private\.academic_subject_director_candidate_is_active_v1\(\s*setting\.default_director_profile_id,\s*setting\.subject\s*\)/i,
  );
  assert.match(listRpc, /else null\s+end\s+as default_director_profile_id/i);
  assert.match(pgTap, /저장된 director가 숨김 상태가 되면 capability 조회는 null로 재검증한다/);
  assert.match(pgTap, /저장된 director가 ban 상태가 되면 capability 조회는 null로 재검증한다/);
  assert.match(pgTap, /저장된 director가 삭제 상태가 되면 capability 조회는 null로 재검증한다/);
});

test("the migration rejects multidimensional grades and non-approved subject areas", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /pg_catalog\.array_ndims\(p_grade_levels\) = 1/i);
  assert.match(
    sql,
    /academic_subject_areas_subject_check[\s\S]*check \(subject = '과학'\)/i,
  );
  assert.match(
    sql,
    /academic_subject_areas_key_check[\s\S]*area_key in \('integrated_science', 'physics', 'chemistry', 'life_science', 'earth_science'\)/i,
  );
});

test("the production settings singleton wires capability reset into its factory", async () => {
  const source = await readFile(serviceSourceUrl, "utf8");

  assert.match(
    source,
    /academicSubjectSettingsService\s*=\s*createAcademicSubjectSettingsService\(\s*supabase[\s\S]*?resetRegistrationSubjectCapabilityProbe\s*,?\s*\)/,
  );
});

test("list maps a complete three-subject snake_case response explicitly", async () => {
  const { createAcademicSubjectSettingsService } = await loadServiceFactory();
  const harness = createClient([{ data: validRows(), error: null }]);
  const service = createAcademicSubjectSettingsService(harness.client);

  const settings = (await service.list()).map(plainSetting);
  assert.deepEqual(settings.map((row) => row.subject), ["영어", "수학", "과학"]);
  assert.deepEqual(settings[2], {
    subject: "과학",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: ["고1", "고2", "고3"],
    defaultDirectorProfileId: "22222222-2222-4222-8222-222222222222",
    sortOrder: 30,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  });
  assert.deepEqual(harness.calls.map(({ name, args }) => ({
    name,
    args: args && {
      ...args,
      p_grade_levels: [...args.p_grade_levels],
    },
  })), [{
    name: "list_registration_subject_capabilities_v1",
    args: undefined,
  }]);
});

test("the documented one-argument service factory works in isolation", async () => {
  const { createAcademicSubjectSettingsService } = await loadServiceFactory();
  const harness = createClient([{ data: validRows(), error: null }]);
  const service = createAcademicSubjectSettingsService(harness.client);

  assert.equal((await service.list()).length, 3);
});

test("settings accept canonical PostgreSQL UUIDs without RFC version restrictions", async () => {
  const { createAcademicSubjectSettingsService } = await loadServiceFactory();
  const rows = validRows();
  rows[2] = {
    ...rows[2],
    default_director_profile_id: "00000000-0000-0000-0000-000000000000",
  };
  const harness = createClient([{ data: rows, error: null }]);
  const service = createAcademicSubjectSettingsService(harness.client);

  assert.equal(
    (await service.list())[2].defaultDirectorProfileId,
    "00000000-0000-0000-0000-000000000000",
  );
});

test("list rejects incomplete, unknown, duplicate, and malformed settings fail closed", async () => {
  const { createAcademicSubjectSettingsService } = await loadServiceFactory();
  const malformedRows = [
    validRows().slice(0, 2),
    [...validRows().slice(0, 2), { ...validRows()[2], subject: "사회" }],
    [...validRows(), { ...validRows()[2] }],
    [...validRows().slice(0, 2), { ...validRows()[2], grade_levels: ["중3", "고1"] }],
    [...validRows().slice(0, 2), { ...validRows()[2], is_active: "true" }],
    [...validRows().slice(0, 2), { ...validRows()[2], updated_at: "not-a-date" }],
  ];

  for (const rows of malformedRows) {
    const harness = createClient([{ data: rows, error: null }]);
    await assert.rejects(
      createAcademicSubjectSettingsService(harness.client).list(),
      (error) => error?.code === "academic_subject_settings_unsafe_response",
    );
  }
});

test("update sends explicit RPC arguments, validates its row, and resets capabilities", async () => {
  const { createAcademicSubjectSettingsService } = await loadServiceFactory();
  const science = validRows()[2];
  const harness = createClient([{ data: [science], error: null }]);
  let resetCount = 0;
  const service = createAcademicSubjectSettingsService(
    harness.client,
    () => { resetCount += 1; },
  );

  const updated = plainSetting(await service.update({
    subject: "과학",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: ["고1", "고2", "고3"],
    defaultDirectorProfileId: "22222222-2222-4222-8222-222222222222",
  }));

  assert.deepEqual(updated, plainSetting({
    subject: science.subject,
    isActive: science.is_active,
    registrationCreateEnabled: science.registration_create_enabled,
    gradeLevels: science.grade_levels,
    defaultDirectorProfileId: science.default_director_profile_id,
    sortOrder: science.sort_order,
    createdAt: science.created_at,
    updatedAt: science.updated_at,
  }));
  assert.deepEqual(harness.calls.map(({ name, args }) => ({
    name,
    args: {
      ...args,
      p_grade_levels: [...args.p_grade_levels],
    },
  })), [{
    name: "update_academic_subject_setting_v1",
    args: {
      p_subject: "과학",
      p_is_active: true,
      p_registration_create_enabled: true,
      p_grade_levels: ["고1", "고2", "고3"],
      p_default_director_profile_id: "22222222-2222-4222-8222-222222222222",
    },
  }]);
  assert.equal(resetCount, 1);
});

test("RPC errors do not reset capabilities, but a committed unsafe response resets before rejection", async () => {
  const { createAcademicSubjectSettingsService } = await loadServiceFactory();
  const rpcError = { code: "42501", message: "permission denied" };
  const malformed = { ...validRows()[2], subject: "영어" };

  for (const result of [
    { data: null, error: rpcError },
    { data: [malformed], error: null },
  ]) {
    const harness = createClient([result]);
    let resetCount = 0;
    const service = createAcademicSubjectSettingsService(
      harness.client,
      () => { resetCount += 1; },
    );
    const update = service.update({
      subject: "과학",
      isActive: true,
      registrationCreateEnabled: true,
      gradeLevels: ["고1", "고2", "고3"],
      defaultDirectorProfileId: null,
    });

    if (result.error) {
      await assert.rejects(update, (error) => error === rpcError);
    } else {
      await assert.rejects(
        update,
        (error) => error?.code === "academic_subject_settings_unsafe_response",
      );
    }
    assert.equal(resetCount, result.error ? 0 : 1);
  }
});
