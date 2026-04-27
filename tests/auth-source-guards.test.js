import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

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
  const appSource = read("src/App.jsx");
  const curriculumProgressSource = read("src/components/CurriculumProgressWorkspace.jsx");
  const classScheduleSource = read("src/components/class-schedule/ClassScheduleWorkspace.jsx");

  assert.match(appSource, /const bottomNavItems = useMemo\([\s\S]*canAccessCurriculumRoadmap/);
  assert.match(curriculumProgressSource, /useAuth/);
  assert.match(curriculumProgressSource, /canEditCurriculumPlanning/);
  assert.match(classScheduleSource, /useAuth/);
  assert.match(classScheduleSource, /canEditClassSchedulePlanning/);
  assert.match(classScheduleSource, /canEditClassSchedule/);
});
