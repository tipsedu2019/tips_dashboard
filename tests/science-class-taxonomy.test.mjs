import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildClassPayload,
  buildClassSubjectOptions,
  isClassroomCatalogForClassSubject,
  isTeacherCatalogForClassSubject,
} from "../src/features/management/management-service.js";
import { normalizeClassManagementRecord } from "../src/features/management/records.js";
import {
  buildCurriculumWorkspaceModel,
  buildTimetableWorkspaceModel,
} from "../src/features/academic/records.js";

const root = new URL("../", import.meta.url);

test("class subject options always include registry subjects before a science class exists", () => {
  assert.deepEqual(
    buildClassSubjectOptions([
      { subject: "영어" },
      { subject: "수학" },
      { subject: "논술" },
    ]),
    ["영어", "수학", "과학", "논술"],
  );
});

test("science class payload normalizes aliases and requires a high grade with an area", () => {
  assert.deepEqual(
    buildClassPayload(
      {
        id: "science-class",
        name: "고2 물리학",
        subject: "science",
        grade: "고2",
        subjectAreaKey: "physics",
      },
      { generateId: () => "generated" },
    ),
    {
      id: "science-class",
      name: "고2 물리학",
      class_type: "정규",
      subject: "과학",
      subject_area_key: "physics",
      grade: "고2",
      teacher: "",
      schedule: "",
      room: "",
      capacity: 0,
      fee: 0,
      status: "수강",
      student_ids: [],
      waitlist_ids: [],
      textbook_ids: [],
    },
  );

  assert.throws(
    () => buildClassPayload({ subject: "과학", grade: "중3", subjectAreaKey: "physics" }),
    /과학 수업은 고1~고3만 선택할 수 있습니다/,
  );
  assert.throws(
    () => buildClassPayload({ subject: "과학", subjectAreaKey: "physics" }),
    /과학 수업은 고1~고3만 선택할 수 있습니다/,
  );
  assert.throws(
    () => buildClassPayload({ subject: "과학", grade: "고1" }),
    /과학 영역을 선택하세요/,
  );
  assert.throws(
    () => buildClassPayload({ subject: "영어", grade: "고1", subjectAreaKey: "physics" }),
    /과학 수업에서만 과학 영역을 선택할 수 있습니다/,
  );
});

test("science class candidates require exact team and root classroom memberships", () => {
  assert.equal(isTeacherCatalogForClassSubject({ subjects: ["과학팀"] }, "과학"), true);
  assert.equal(isTeacherCatalogForClassSubject({ subjects: ["과학"] }, "과학"), false);
  assert.equal(isTeacherCatalogForClassSubject({ subjects: [] }, "과학"), false);
  assert.equal(isTeacherCatalogForClassSubject({ subjects: ["영어팀", "과학팀"] }, "science"), true);

  assert.equal(isClassroomCatalogForClassSubject({ subjects: ["과학"] }, "과학"), true);
  assert.equal(isClassroomCatalogForClassSubject({ subjects: ["과학팀"] }, "과학"), false);
  assert.equal(isClassroomCatalogForClassSubject({ subjects: [] }, "과학"), false);
  assert.equal(isClassroomCatalogForClassSubject({ subjects: ["영어", "과학"] }, "science"), true);
});

test("science class payload rejects selections outside provided exact candidate context", () => {
  const candidateMembershipContext = {
    teacherCatalogs: [
      { name: "과학 선생", subjects: ["과학팀"], is_visible: true },
      { name: "영어 선생", subjects: ["영어팀"], is_visible: true },
      { name: "숨김 선생", subjects: ["과학팀"], is_visible: false },
    ],
    classroomCatalogs: [
      { name: "과학실", subjects: ["과학"], is_visible: true },
      { name: "영어실", subjects: ["영어"], is_visible: true },
      { name: "숨김 과학실", subjects: ["과학"], is_visible: false },
    ],
  };
  const scienceClass = {
    subject: "과학",
    grade: "고2",
    subjectAreaKey: "physics",
    teacher: "과학 선생",
    classroom: "과학실",
  };

  assert.doesNotThrow(() => buildClassPayload(scienceClass, { candidateMembershipContext }));
  assert.throws(
    () => buildClassPayload({ ...scienceClass, teacher: "영어 선생" }, { candidateMembershipContext }),
    /과학팀 교사/,
  );
  assert.throws(
    () => buildClassPayload({ ...scienceClass, classroom: "영어실" }, { candidateMembershipContext }),
    /과학 강의실/,
  );
  assert.throws(
    () => buildClassPayload({ ...scienceClass, teacher: "", classroom: "" }, {
      candidateMembershipContext: { teacherCatalogs: [], classroomCatalogs: [] },
    }),
    /과학팀 교사/,
  );
});

test("legacy science resources stay readable but science subject changes clear invalid selections", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const legacy = normalizeClassManagementRecord({
    id: "legacy-science",
    name: "기존 과학반",
    subject: "과학",
    grade: "고1",
    teacher: "기존 담당자",
    room: "기존 강의실",
    subject_area_key: "integrated_science",
  });

  assert.equal(legacy.raw.teacher, "기존 담당자");
  assert.equal(legacy.raw.classroom, "기존 강의실");
  assert.match(pageSource, /return value && !options\.includes\(value\) \? \[value, \.\.\.options\] : options/);
  assert.match(pageSource, /const enforceExactScienceCandidates = isScienceClassSubject\(nextSubject\)/);
  assert.match(pageSource, /scienceClassCandidateSelectionBlocked/);
  assert.match(pageSource, /candidateMembershipContext: classFormReferences/);
  assert.doesNotMatch(pageSource, /slot\.teacher && teacherOptions\.length > 0 && !teacherOptions\.includes\(slot\.teacher\)/);
  assert.doesNotMatch(pageSource, /slot\.classroom && classroomOptions\.length > 0 && !classroomOptions\.includes\(slot\.classroom\)/);
});

test("class area keys survive management and academic record normalization", () => {
  const source = {
    id: "science-class",
    name: "고2 물리학",
    subject: "과학",
    subject_area_key: "physics",
    grade: "고2",
    schedule: "월 18:00-20:00",
  };
  const management = normalizeClassManagementRecord(source);
  const timetable = buildTimetableWorkspaceModel({ classes: [source] });
  const curriculum = buildCurriculumWorkspaceModel({ classes: [source] });

  assert.equal(management.raw.subject_area_key, "physics");
  assert.equal(management.raw.subjectAreaKey, "physics");
  assert.equal(timetable.rows[0].subjectAreaKey, "physics");
  assert.equal(curriculum.rows[0].subjectAreaKey, "physics");
});

test("class form loads active areas and subject-aware teacher and classroom catalogs", async () => {
  const [pageSource, hookSource] = await Promise.all([
    readFile(new URL("src/features/management/management-page.tsx", root), "utf8"),
    readFile(new URL("src/features/management/use-management-records.ts", root), "utf8"),
  ]);

  assert.match(pageSource, /ACADEMIC_SUBJECT_VALUES/);
  assert.match(pageSource, /isScienceGrade/);
  assert.match(pageSource, /subjectAreaKey/);
  assert.match(pageSource, /과학 영역/);
  assert.match(pageSource, /availableClassroomCatalogs|classroomCatalogs/);
  assert.match(pageSource, /return isTeacherCatalogForClassSubject\(catalog, subject\)/);
  assert.match(pageSource, /catalog\.is_visible !== false && isClassTeacherCatalogForSubject\(catalog, subject\)/);
  assert.match(pageSource, /catalog\.is_visible !== false && isClassroomCatalogForClassSubject\(catalog, selectedSubject\)/);
  assert.match(hookSource, /list_active_science_subject_areas_v1/);
  assert.match(hookSource, /classroom_catalogs/);
});

test("science class and textbook migration uses mapped composite area references and write guards", async () => {
  const sql = await readFile(
    new URL("supabase/migrations/20260722110000_science_classes_and_textbooks.sql", root),
    "utf8",
  );

  assert.match(sql, /alter table public\.classes[\s\S]*add column if not exists subject_area_key text/i);
  assert.match(sql, /alter table public\.textbooks[\s\S]*add column if not exists subject_area_key text/i);
  assert.match(sql, /foreign key \(subject, subject_area_key\)[\s\S]*references public\.academic_subject_areas\(subject, area_key\)/i);
  assert.match(sql, /generated always as[\s\S]*when subject = 'science' then '과학'/i);
  assert.match(sql, /foreign key \(subject_area_subject, subject_area_key\)[\s\S]*references public\.academic_subject_areas\(subject, area_key\)/i);
  assert.match(sql, /is_active = true/i);
  assert.match(sql, /classes_science_taxonomy_check[\s\S]*grade is not null[\s\S]*grade in \('고1', '고2', '고3'\)/i);
  assert.match(sql, /textbooks_science_taxonomy_check[\s\S]*array\['high'\][\s\S]*array\['h1', 'h2', 'h3'\]/i);
  assert.match(sql, /list_active_science_subject_areas_v1/i);
});
