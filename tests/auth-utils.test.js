import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LOGIN_EMAIL_DOMAIN,
  getRoleCapabilities,
  normalizeLoginIdentifier,
  shouldForcePasswordChange,
} from "../src/lib/authUtils.js";

test("login identifier appends the tipsedu domain for bare ids", () => {
  assert.equal(DEFAULT_LOGIN_EMAIL_DOMAIN, "tipsedu.co.kr");
  assert.equal(
    normalizeLoginIdentifier("010-9954-2979"),
    "010-9954-2979@tipsedu.co.kr",
  );
});

test("login identifier preserves explicit emails and trims whitespace", () => {
  assert.equal(
    normalizeLoginIdentifier("  010-9954-2979@tipsedu.co.kr  "),
    "010-9954-2979@tipsedu.co.kr",
  );
});

test("role capabilities keep viewer in public mode and teacher limited to curriculum planning", () => {
  assert.deepEqual(getRoleCapabilities("admin"), {
    canAccessDashboard: true,
    canManageAll: true,
    canEditCurriculumPlanning: true,
    canEditClassSchedule: true,
  });

  assert.deepEqual(getRoleCapabilities("staff"), {
    canAccessDashboard: true,
    canManageAll: true,
    canEditCurriculumPlanning: true,
    canEditClassSchedule: true,
  });

  assert.deepEqual(getRoleCapabilities("teacher"), {
    canAccessDashboard: true,
    canManageAll: false,
    canEditCurriculumPlanning: true,
    canEditClassSchedule: false,
  });

  assert.deepEqual(getRoleCapabilities("viewer"), {
    canAccessDashboard: false,
    canManageAll: false,
    canEditCurriculumPlanning: false,
    canEditClassSchedule: false,
  });
});

test("forced password change can come from profile or auth user metadata", () => {
  assert.equal(shouldForcePasswordChange({ must_change_password: true }), true);
  assert.equal(
    shouldForcePasswordChange({
      user_metadata: {
        must_change_password: true,
      },
    }),
    true,
  );
  assert.equal(
    shouldForcePasswordChange({
      user_metadata: {
        mustChangePassword: true,
      },
    }),
    true,
  );
  assert.equal(shouldForcePasswordChange({}), false);
});
