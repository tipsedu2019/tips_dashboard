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
        campus: "별관",
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

test("classroom campus is explicit and never inferred from its name", () => {
  const [annexNamedMainCampus] = buildResourceCatalogPayload(
    [{
      id: "room-1",
      name: "별관 4강",
      subjects: ["영어"],
      campus: "본관",
    }],
    { kind: "classroom" },
  );
  const [mainNamedAnnexCampus] = buildResourceCatalogPayload(
    [{
      id: "room-2",
      name: "본관 3강",
      subjects: ["수학"],
      campus: "별관",
    }],
    { kind: "classroom" },
  );

  assert.equal(annexNamedMainCampus.campus, "본관");
  assert.equal(mainNamedAnnexCampus.campus, "별관");
});

test("classroom campus rejects missing values without changing teacher payloads", () => {
  for (const campus of ["", "제3관", undefined]) {
    assert.throws(
      () => buildResourceCatalogPayload(
        [{ id: "invalid-campus", name: "본관 3강", subjects: ["수학"], campus }],
        { kind: "classroom" },
      ),
      /강의실 건물을 선택해 주세요/,
    );
  }

  const [teacherPayload] = buildResourceCatalogPayload(
    [{ id: "teacher", name: "영어 선생님", subjects: ["영어"], campus: "본관" }],
    { kind: "teacher" },
  );
  assert.equal(Object.hasOwn(teacherPayload, "campus"), false);
});

test("classrooms missing campus stay visible under every subject filter", async () => {
  const managementModule = await import("../src/features/management/management-service.js");
  assert.equal(typeof managementModule.filterClassroomCatalogRowsForSubject, "function");

  const rows = [
    { id: "missing-campus", subjects: ["수학"], campus: "" },
    { id: "matching", subjects: ["영어"], campus: "본관" },
    { id: "other-subject", subjects: ["수학"], campus: "별관" },
  ];

  assert.deepEqual(
    managementModule.filterClassroomCatalogRowsForSubject(rows, "영어").map((row) => row.id),
    ["missing-campus", "matching"],
  );
  assert.deepEqual(
    managementModule.filterClassroomCatalogRowsForSubject(rows, "전체").map((row) => row.id),
    ["missing-campus", "matching", "other-subject"],
  );
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

test("classroom workspace loads and edits explicit campus in both layouts", async () => {
  const [workspaceSource, managementServiceSource] = await Promise.all([
    readFile(
      new URL("src/features/management/classroom-master-workspace.tsx", root),
      "utf8",
    ),
    readFile(
      new URL("src/features/management/management-service.js", root),
      "utf8",
    ),
  ]);

  assert.match(workspaceSource, /campus: "본관" \| "별관" \| ""/);
  assert.match(
    workspaceSource,
    /\{ id: "name", label: "이름", required: true \}/,
    "the combined name and campus column must remain visible on desktop",
  );
  assert.match(workspaceSource, /select\("id, name, subjects, campus, is_visible, sort_order"\)/);
  assert.match(workspaceSource, /campus: ""/);
  assert.match(workspaceSource, /campus: row\.campus/);
  assert.match(workspaceSource, /강의실 건물/);
  assert.match(workspaceSource, /건물 미지정/);
  assert.ok(
    (workspaceSource.match(/<ClassroomCampusSelect/g) || []).length >= 2,
    "mobile and desktop must share the same campus select",
  );
  assert.doesNotMatch(
    managementServiceSource,
    /name[^\n]*(?:includes|startsWith)[^\n]*(?:본관|별관)|(?:본관|별관)[^\n]*(?:includes|startsWith)[^\n]*name/,
  );
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
