import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateManagementListPageSize,
  managementPageSizeStorageKey,
  parseManagementPageSizePreference,
  pickManagementListPageSize,
} from "../src/features/management/management-page-size.ts";

test("management sizing quantizes measured row capacity without exceeding 20", () => {
  assert.equal(pickManagementListPageSize(9), 10);
  assert.equal(pickManagementListPageSize(10), 10);
  assert.equal(pickManagementListPageSize(14), 10);
  assert.equal(pickManagementListPageSize(15), 15);
  assert.equal(pickManagementListPageSize(19), 15);
  assert.equal(pickManagementListPageSize(20), 20);
  assert.equal(pickManagementListPageSize(200), 20);
});

test("management sizing accepts only a versioned user override", () => {
  assert.deepEqual(parseManagementPageSizePreference('{"version":1,"size":15}'), { version: 1, size: 15 });
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":30}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":2,"size":20}'), null);
  assert.equal(parseManagementPageSizePreference("broken"), null);
});

test("management sizing estimates viewport capacities at fixed breakpoints", () => {
  assert.equal(estimateManagementListPageSize(759), 10);
  assert.equal(estimateManagementListPageSize(760), 15);
  assert.equal(estimateManagementListPageSize(940), 20);
});

test("management sizing uses a versioned kind-specific storage key", () => {
  assert.equal(managementPageSizeStorageKey("students"), "tips:management-page-size:students:v1");
  assert.equal(managementPageSizeStorageKey("classes"), "tips:management-page-size:classes:v1");
  assert.equal(managementPageSizeStorageKey("textbooks"), "tips:management-page-size:textbooks:v1");
});
