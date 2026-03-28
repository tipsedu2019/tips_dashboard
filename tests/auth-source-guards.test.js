import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("C:/Antigravity/tips_dashboard");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("login flow uses the tipsedu domain and mounts the forced password change modal", () => {
  const appSource = read("src/App.jsx");
  const settingsSource = read("src/components/SettingsModal.jsx");

  assert.match(settingsSource, /tipsedu\.co\.kr/);
  assert.match(appSource, /ChangePasswordModal/);
  assert.match(appSource, /canAccessDashboard/);
});

test("teacher and staff permissions are enforced in the planning and class-schedule workspaces", () => {
  const curriculumProgressSource = read("src/components/CurriculumProgressWorkspace.jsx");
  const classScheduleSource = read("src/components/class-schedule/ClassScheduleWorkspace.jsx");

  assert.match(curriculumProgressSource, /useAuth/);
  assert.match(curriculumProgressSource, /canEditCurriculumPlanning/);
  assert.match(classScheduleSource, /useAuth/);
  assert.match(classScheduleSource, /canEditClassSchedulePlanning/);
  assert.match(classScheduleSource, /canEditClassSchedule/);
});
