import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_CLASS_STATUS,
  CLASS_STATUS_OPTIONS,
  PREPARING_CLASS_STATUS,
  computeClassStatus,
  normalizeClassStatus,
} from "../src/lib/class-status.js";
import { buildClassPayload } from "../src/features/management/management-service.js";
import { buildClassManagementStats } from "../src/features/management/records.js";

test("class status labels use the current service-facing vocabulary", () => {
  assert.equal(ACTIVE_CLASS_STATUS, "수강");
  assert.equal(PREPARING_CLASS_STATUS, "개강 준비");
  assert.deepEqual(CLASS_STATUS_OPTIONS, ["수강", "개강 준비", "종강"]);
});

test("legacy class statuses are normalized to current labels", () => {
  assert.equal(normalizeClassStatus("수업 진행 중"), "수강");
  assert.equal(normalizeClassStatus("개강"), "수강");
  assert.equal(normalizeClassStatus("개강 준비 중"), "개강 준비");
  assert.equal(normalizeClassStatus("개강 예정"), "개강 준비");
});

test("class payloads and computed statuses default to current active label", () => {
  assert.equal(buildClassPayload({ name: "고1 테스트" }).status, "수강");
  assert.equal(computeClassStatus({ name: "고1 테스트" }, new Date("2026-04-27T00:00:00+09:00")), "수강");
});

test("class management summary uses current status labels", () => {
  const stats = buildClassManagementStats([
    { metrics: { status: ACTIVE_CLASS_STATUS, capacity: 10 } },
    { metrics: { status: PREPARING_CLASS_STATUS, capacity: 8 } },
  ]);

  assert.deepEqual(stats.map((stat) => stat.label), ["총 수업", "수강", "개강 준비", "총 정원"]);
});
