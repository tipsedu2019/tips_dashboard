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

test("class deep-link search never rewrites URL-owned status or period filters", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  const directStatusLink = model.reconcilePendingManagementSearch({
    pendingSearch: null,
    currentInput: "없는검색어",
    debouncedInput: "없는검색어",
    requestedSearch: "없는검색어",
    composing: false,
  });
  assert.deepEqual(directStatusLink, {
    shouldSyncUrl: false,
    pendingSearch: null,
  });

  const directPeriodLink = model.reconcilePendingManagementSearch({
    pendingSearch: null,
    currentInput: "테스트",
    debouncedInput: "테스트",
    requestedSearch: "테스트",
    composing: false,
  });
  assert.deepEqual(directPeriodLink, {
    shouldSyncUrl: false,
    pendingSearch: null,
  });
});

test("user-owned search writes once after debounce and stops after the URL catches up", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  assert.deepEqual(
    model.reconcilePendingManagementSearch({
      pendingSearch: "새 검색",
      currentInput: "새 검색",
      debouncedInput: "이전 검색",
      requestedSearch: "이전 검색",
      composing: false,
    }),
    { shouldSyncUrl: false, pendingSearch: "새 검색" },
  );

  assert.deepEqual(
    model.reconcilePendingManagementSearch({
      pendingSearch: "새 검색",
      currentInput: "새 검색",
      debouncedInput: "새 검색",
      requestedSearch: "이전 검색",
      composing: false,
    }),
    { shouldSyncUrl: true, pendingSearch: "새 검색" },
  );

  assert.deepEqual(
    model.reconcilePendingManagementSearch({
      pendingSearch: "새 검색",
      currentInput: "새 검색",
      debouncedInput: "새 검색",
      requestedSearch: "새 검색",
      composing: false,
    }),
    { shouldSyncUrl: false, pendingSearch: null },
  );

  assert.deepEqual(
    model.reconcilePendingManagementSearch({
      pendingSearch: null,
      currentInput: "새 검색",
      debouncedInput: "새 검색",
      requestedSearch: "뒤로가기 검색",
      composing: false,
    }),
    { shouldSyncUrl: false, pendingSearch: null },
  );
});

test("default period canonicalization preserves URL-owned class search and status", async () => {
  const model = await loadTransitionModel();
  assert.ok(model, "management filter transition model should exist");

  assert.deepEqual(
    model.withRequestedDefaultClassPeriod({
      q: "테스트",
      period: "",
      status: "종강",
      subject: "영어",
      grade: "중1",
      teacher: "김교사",
      classroom: "1강의실",
    }, "period-default"),
    {
      q: "테스트",
      period: "period-default",
      status: "종강",
      subject: "영어",
      grade: "중1",
      teacher: "김교사",
      classroom: "1강의실",
    },
  );
});
