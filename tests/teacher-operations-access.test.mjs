import test from "node:test";
import assert from "node:assert/strict";
import { getRoleCapabilities } from "../src/lib/auth-utils.ts";
import { buildAdminNavGroups, resolveAdminWorkspaceMeta } from "../src/lib/navigation.ts";

function nav(role) {
  return buildAdminNavGroups({ ...getRoleCapabilities(role), isAdmin: role === "admin" });
}

test("teachers discover curriculum and requests in operations without management or settings", () => {
  const groups = nav("teacher");
  assert.deepEqual(groups.map(group => group.label), ["운영", "영어"]);
  const operations = groups.find(group => group.label === "운영");
  assert.ok(operations.items.some(item => item.title === "수업계획" && item.url === "/admin/curriculum"));
  assert.ok(operations.items.some(item => item.title === "교재요청" && item.url === "/admin/textbook-requests"));
  assert.ok(!groups.flatMap(group => group.items).some(item => item.url === "/admin/textbooks"));
});

test("management retains textbook management while requests have one operational destination", () => {
  for (const role of ["admin", "staff"]) {
    const groups = nav(role);
    const operations = groups.find(group => group.label === "운영");
    const management = groups.find(group => group.label === "관리");
    assert.ok(operations.items.some(item => item.url === "/admin/curriculum"));
    assert.ok(operations.items.some(item => item.url === "/admin/textbook-requests"));
    assert.ok(management.items.some(item => item.url === "/admin/textbooks"));
    assert.ok(!management.items.some(item => item.url === "/admin/curriculum" || item.url === "/admin/textbook-requests"));
  }
});

test("moved workspace metadata agrees with operational navigation and deep links", () => {
  for (const path of ["/admin/curriculum", "/admin/curriculum/lesson-design", "/admin/class-schedule", "/admin/class-schedule/lesson-design", "/admin/textbook-requests"]) {
    assert.equal(resolveAdminWorkspaceMeta(path).section, "운영", path);
  }
  assert.equal(resolveAdminWorkspaceMeta("/admin/textbook-requests").title, "교재요청");
  assert.equal(resolveAdminWorkspaceMeta("/admin/textbooks").section, "관리");
});

test("teacher can read operational planning but only managers may edit it", () => {
  for (const role of ["admin", "staff", "teacher", "assistant", "viewer"]) {
    const caps = getRoleCapabilities(role);
    assert.equal(caps.canReadOperations, ["admin", "staff", "teacher"].includes(role));
    assert.equal(caps.canEditCurriculumPlanning, ["admin", "staff"].includes(role));
    assert.equal(caps.canEditClassSchedulePlanning, ["admin", "staff"].includes(role));
  }
});

test("assistant navigation contains only its approved word-retest workflow", () => {
  const groups = nav("assistant");
  assert.deepEqual(groups.map(group => group.label), ["영어"]);
  assert.deepEqual(groups.flatMap(group => group.items).map(item => item.url), ["/admin/word-retests"]);
  assert.equal(getRoleCapabilities("assistant").defaultAdminPath, "/admin/word-retests");
  assert.equal(getRoleCapabilities("assistant").canUseAiAgentRequests, false);
});

test("viewer navigation is not expanded by the teacher policy", () => {
  const groups = nav("viewer");
  assert.deepEqual(groups.map(group => group.label), ["운영", "영어", "관리"]);
  assert.deepEqual(groups.find(group => group.label === "관리").items.map(item => item.url), ["/admin/statistics"]);
  assert.ok(!groups.flatMap(group => group.items).some(item => item.url === "/admin/curriculum" || item.url === "/admin/textbook-requests"));
});
