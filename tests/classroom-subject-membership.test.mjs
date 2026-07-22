import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildResourceCatalogPayload,
  normalizeClassroomName,
} from "../src/features/management/management-service.js";
import { normalizeTimetableClassroomName } from "../src/features/academic/records.js";

const root = new URL("../", import.meta.url);

test("classroom payload preserves multiple subjects in registry order", () => {
  const [payload] = buildResourceCatalogPayload(
    [
      {
        id: "classroom-shared",
        name: "별관 4강",
        subjects: ["과학", "영어"],
        isVisible: true,
        sortOrder: 4,
      },
    ],
    { kind: "classroom" },
  );

  assert.deepEqual(payload.subjects, ["영어", "과학"]);
});

test("classroom-only payload validation rejects empty and unknown memberships", () => {
  for (const subjects of [[], ["영어", "사회"]]) {
    assert.throws(
      () => buildResourceCatalogPayload(
        [{ id: "invalid", name: "검증실", subjects }],
        { kind: "classroom" },
      ),
      /강의실 과목/,
    );
  }

  const [teacherPayload] = buildResourceCatalogPayload(
    [{ id: "teacher", name: "과학 선생님", subjects: ["과학팀", "연구팀"] }],
    { kind: "teacher" },
  );
  assert.deepEqual(teacherPayload.subjects, ["과학팀", "연구팀"]);
});

test("classroom workspace keeps AcademicSubjectValue arrays and shared toggles on mobile and desktop", async () => {
  const source = await readFile(
    new URL("src/features/management/classroom-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(source, /subjects: AcademicSubjectValue\[\]/);
  assert.match(source, /sortAcademicSubjects/);
  assert.match(source, /function ClassroomSubjectToggles/);
  assert.match(source, /handleSubjectToggle/);
  assert.match(source, /subjects: \[\.\.\.row\.subjects\]/);
  assert.match(source, /강의실 과목을 하나 이상 선택해 주세요\./);
  assert.ok(
    (source.match(/<ClassroomSubjectToggles/g) || []).length >= 2,
    "mobile and desktop must share the same multi-toggle",
  );
  assert.doesNotMatch(source, /subjects: \[normalizeSubjectValue/);
});

test("fourth annex classroom aliases normalize consistently", () => {
  for (const alias of ["별4", "별4강", "별관4강"]) {
    assert.equal(normalizeClassroomName(alias), "별관 4강");
    assert.equal(normalizeTimetableClassroomName(alias), "별관 4강");
  }
});

test("forward migration updates the existing fourth annex classroom and guards new memberships", async () => {
  const sql = await readFile(
    new URL(
      "supabase/migrations/20260722093000_science_team_and_classroom.sql",
      root,
    ),
    "utf8",
  );

  assert.match(
    sql,
    /update public\.classroom_catalogs[\s\S]*coalesce\(subjects, array\[\]::text\[\]\) \|\| array\['과학'\][\s\S]*where pg_catalog\.btrim\(name\) = '별관 4강'/i,
  );
  assert.doesNotMatch(sql, /insert into public\.classroom_catalogs/i);
  assert.match(
    sql,
    /check \([\s\S]*cardinality\(subjects\) > 0[\s\S]*subjects <@ array\['영어', '수학', '과학'\]::text\[\][\s\S]*\) not valid/i,
  );
});
