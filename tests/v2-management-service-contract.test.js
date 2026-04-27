import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademicSchoolPayload,
  buildClassTermPayload,
  buildResourceCatalogPayload,
  createManagementService,
} from "../v2/src/features/management/management-service.js";

test("buildAcademicSchoolPayload keeps academic school table fields only", () => {
  assert.deepEqual(
    buildAcademicSchoolPayload([
      {
        id: "school-1",
        name: "중앙고",
        category: "high",
        color: "#216e4e",
        textbooks: { 영어: ["book-1"] },
      },
      {
        id: "school-2",
        name: "중앙중",
        category: "middle",
      },
    ]),
    [
      {
        id: "school-1",
        name: "중앙고",
        category: "high",
        color: "#216e4e",
        sort_order: 0,
      },
      {
        id: "school-2",
        name: "중앙중",
        category: "middle",
        color: null,
        sort_order: 1,
      },
    ],
  );
});

test("buildResourceCatalogPayload trims names, dedupes subjects, and normalizes classroom names", () => {
  const seed = () => "generated-id";

  assert.deepEqual(
    buildResourceCatalogPayload(
      [
        {
          name: "  한지현  ",
          subjects: ["영어", "영어", " ", "고등영어"],
          isVisible: true,
        },
      ],
      { kind: "teacher", generateId: seed },
    ),
    [
      {
        id: "generated-id",
        name: "한지현",
        subjects: ["영어", "고등영어"],
        is_visible: true,
        sort_order: 0,
      },
    ],
  );

  assert.deepEqual(
    buildResourceCatalogPayload(
      [
        {
          name: " 별5 ",
          subjects: ["영어", "영어"],
          isVisible: false,
          sortOrder: 3,
        },
      ],
      { kind: "classroom", generateId: seed },
    ),
    [
      {
        id: "generated-id",
        name: "별관 5강",
        subjects: ["영어"],
        is_visible: false,
        sort_order: 3,
      },
    ],
  );
});

test("buildClassTermPayload mirrors v1 academic year, status, and date fields", () => {
  const seed = () => "term-id";

  assert.deepEqual(
    buildClassTermPayload(
      [
        {
          name: "2026 1학기",
          academicYear: "2026",
          startDate: "2026-03-01",
          endDate: "2026-07-20",
        },
      ],
      { generateId: seed },
    ),
    [
      {
        id: "term-id",
        academic_year: 2026,
        name: "2026 1학기",
        status: "수강",
        start_date: "2026-03-01",
        end_date: "2026-07-20",
        sort_order: 0,
      },
    ],
  );
});

test("createManagementService returns localized supabase-missing errors for write operations", async () => {
  const service = createManagementService({ supabase: null });

  await assert.rejects(
    () => service.upsertAcademicSchools([]),
    /Supabase 연결 설정을 확인해 주세요\./,
  );
  await assert.rejects(
    () => service.upsertTeacherCatalogs([]),
    /Supabase 연결 설정을 확인해 주세요\./,
  );
  await assert.rejects(
    () => service.upsertClassroomCatalogs([]),
    /Supabase 연결 설정을 확인해 주세요\./,
  );
  await assert.rejects(
    () => service.upsertClassTerms([]),
    /Supabase 연결 설정을 확인해 주세요\./,
  );
});
