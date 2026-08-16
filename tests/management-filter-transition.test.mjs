import test from "node:test";
import assert from "node:assert/strict";

const moduleUrl = new URL(
  "../src/features/management/management-filter-transition.js",
  import.meta.url,
);

async function loadTransitionModel() {
  try {
    return await import(moduleUrl);
  } catch {
    return null;
  }
}

test("student filter selection stays optimistic until the URL catches up", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  const current = {
    q: "",
    status: "",
    schoolCategory: "middle",
    school: "",
    grade: "",
  };
  const pending = { ...current };
  const staleUrl = { ...current, schoolCategory: "" };

  assert.deepEqual(
    model.reconcilePendingManagementFilters({ current, requested: staleUrl, pending }),
    { filters: current, pending },
  );

  assert.deepEqual(
    model.reconcilePendingManagementFilters({ current, requested: pending, pending }),
    { filters: pending, pending: null },
  );

  const externalNavigation = { ...current, schoolCategory: "high" };
  assert.deepEqual(
    model.reconcilePendingManagementFilters({
      current,
      requested: externalNavigation,
      pending: null,
    }),
    { filters: externalNavigation, pending: null },
  );
});

test("management refresh keeps existing rows instead of replacing them with short skeletons", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  assert.equal(model.shouldRenderManagementInitialLoading(true, 0), true);
  assert.equal(model.shouldRenderManagementInitialLoading(true, 30), false);
  assert.equal(model.shouldRenderManagementInitialLoading(false, 0), false);
});

test("student filter URL updates use native history without an RSC navigation", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  const calls = [];
  const history = {
    replaceState: (...args) => calls.push(args),
  };

  model.replaceManagementListUrl(history, "/admin/students?schoolCategory=middle");
  assert.deepEqual(calls, [[null, "", "/admin/students?schoolCategory=middle"]]);
});

test("student school category keeps server values and shows Korean labels", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  assert.equal(model.formatStudentSchoolCategoryLabel("elementary"), "초등");
  assert.equal(model.formatStudentSchoolCategoryLabel("middle"), "중등");
  assert.equal(model.formatStudentSchoolCategoryLabel("high"), "고등");
  assert.equal(model.formatStudentSchoolCategoryLabel("중등"), "중등");
  assert.deepEqual(
    model.sortStudentSchoolCategoryValues(["middle", "elementary", "high"]),
    ["elementary", "middle", "high"],
  );
});
