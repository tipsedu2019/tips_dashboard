import assert from "node:assert/strict";
import test from "node:test";
import { createManagementService } from "../src/features/management/management-service.js";

function fixture({ failure = "network" } = {}) {
  let catalog = {
    id: "teacher-a", name: "합성교사", subjects: ["영어팀"], profile_id: "profile-a",
    account_email: "synthetic@example.invalid", dashboard_role: "teacher",
    is_visible: true, sort_order: 1,
  };
  let profile = { id: "profile-a", role: "teacher", teacher_catalog_id: "teacher-a" };
  const calls = { catalog: 0, profile: 0 };
  const client = {
    from(table) {
      assert.ok(["teacher_catalogs", "profiles"].includes(table));
      return {
        select() {
          return { in: async () => ({ data: [{ ...(table === "profiles" ? profile : catalog) }], error: null }) };
        },
        upsert(rows) {
          assert.equal(table, "teacher_catalogs");
          calls.catalog += 1;
          catalog = { ...rows[0] };
          return { select: async () => ({ data: rows, error: null }) };
        },
        update(patch) {
          assert.equal(table, "profiles");
          calls.profile += 1;
          return { eq: () => ({ select: async () => {
            if (calls.profile === 1) {
              if (failure === "network") return { data: null, error: { code: "NETWORK_ERROR" } };
              if (failure === "empty") return { data: [], error: null };
              if (failure === "unchanged") return { data: [{ ...profile }], error: null };
            }
            profile = { ...profile, ...patch };
            return { data: [{ ...profile }], error: null };
          } }) };
        },
      };
    },
  };
  return {
    service: createManagementService({ supabase: client }),
    input: [{ ...catalog, dashboard_role: "staff" }],
    catalog: () => catalog, profile: () => profile, calls,
  };
}

for (const failure of ["network", "empty", "unchanged"]) {
  test(`permission save retries the actual profile after ${failure} despite an unchanged catalog`, async () => {
    const f = fixture({ failure });
    await assert.rejects(f.service.upsertTeacherCatalogs(f.input), error =>
      failure === "network" ? error.code === "NETWORK_ERROR" : /저장 결과를 확인하지 못했습니다/.test(error.message));
    assert.equal(f.catalog().dashboard_role, "staff");
    assert.equal(f.profile().role, "teacher");
    await f.service.upsertTeacherCatalogs(f.input);
    assert.equal(f.profile().role, "staff");
    assert.deepEqual(f.calls, { catalog: 1, profile: 2 });
    await f.service.upsertTeacherCatalogs(f.input);
    assert.deepEqual(f.calls, { catalog: 1, profile: 2 }, "already reconciled roles need no redundant write");
  });
}
