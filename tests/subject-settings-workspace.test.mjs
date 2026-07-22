import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("subject settings has a dedicated route and navigation entry before generic settings", async () => {
  const [navigationSource, pageSource] = await Promise.all([
    readSource("src/lib/navigation.ts"),
    readSource("src/app/admin/settings/subjects/page.tsx"),
  ]);

  const subjectMetaIndex = navigationSource.indexOf(
    'match: "/admin/settings/subjects"',
  );
  const genericMetaIndex = navigationSource.indexOf('match: "/admin/settings"');

  assert.ok(subjectMetaIndex >= 0, "subject settings metadata must exist");
  assert.ok(
    subjectMetaIndex < genericMetaIndex,
    "specific subject metadata must precede generic settings metadata",
  );
  assert.match(navigationSource, /title: "과목 설정"/);
  assert.match(
    navigationSource,
    /{ title: "과목 설정", url: "\/admin\/settings\/subjects" }/,
  );
  assert.match(pageSource, /SubjectMasterWorkspace/);
  assert.match(pageSource, /<SubjectMasterWorkspace \/>/);
});

test("subject workspace uses three fixed registry rows and never edits stable keys", async () => {
  const source = await readSource(
    "src/features/management/subject-master-workspace.tsx",
  );

  assert.match(source, /const SUBJECT_ROWS = ACADEMIC_SUBJECTS/);
  assert.match(source, /SUBJECT_ROWS\.map\(\(subject\) =>/);
  assert.match(source, /data-subject-key=\{subject\.key\}/);
  assert.match(source, /row\.gradeLevels\.join\(", "\)/);
  assert.doesNotMatch(source, /subject\.grades\.join\(", "\)/);
  assert.doesNotMatch(source, /<Input\b/);
  assert.doesNotMatch(source, /onChange=\{[^}]*subject\.key/);
});

test("subject workspace loads once, filters directors, and fails closed for non-admin saves", async () => {
  const source = await readSource(
    "src/features/management/subject-master-workspace.tsx",
  );

  assert.equal(
    source.match(/academicSubjectSettingsService\.list\(\)/g)?.length,
    1,
    "settings must be loaded once per workspace",
  );
  assert.equal(
    source.match(/managementService\.listTeacherAccountSettingsData\(\)/g)
      ?.length,
    1,
    "teacher candidates must be loaded once per workspace",
  );
  assert.match(source, /const workspaceLoadRef = useRef/);
  assert.match(source, /workspaceLoadRef\.current \?\?= Promise\.all/);
  assert.match(source, /const \{ isAdmin \} = useAuth\(\)/);
  assert.match(source, /if \(!isAdmin\) \{[\s\S]*?return;?[\s\S]*?\}/);
  assert.match(source, /\{isAdmin \? \(/);
  assert.match(source, /disabled=\{!isAdmin/);
  assert.match(source, /teacher\.is_visible !== false/);
  assert.match(source, /teacher\.profile_id/);
  assert.match(source, /subject\.team/);
  assert.match(source, /teacher\.subjects/);
  assert.match(source, /기존 자동 배정/);
  assert.match(source, /미지정/);
});
