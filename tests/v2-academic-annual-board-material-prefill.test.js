import test from "node:test";
import assert from "node:assert/strict";

import { buildAcademicAnnualBoardModel } from "../v2/src/features/operations/academic-calendar-models.js";

test("annual board derived subject entries keep structured supplement scopes for edit-form prefills", () => {
  const model = buildAcademicAnnualBoardModel({
    academicSchools: [{ id: "hs", name: "사대부고", category: "high" }],
    academicEvents: [
      {
        id: "exam-window",
        school_id: "hs",
        school: "사대부고",
        title: "사대부고 중간고사",
        type: "시험기간",
        start: "2026-04-29",
        end: "2026-05-01",
        grade: "고1",
        academic_year: "2026",
        note: '[[TIPS_META]] {"examTerm":"1학기 중간"}',
      },
    ],
    academicEventExamDetails: [
      {
        id: "detail-math",
        academic_event_id: "exam-window",
        school_id: "hs",
        grade: "고1",
        subject: "수학",
        supplement_scope: "1단원",
      },
    ],
    academicCurriculumProfiles: [
      {
        id: "profile-math",
        academic_year: "2026",
        school_id: "hs",
        grade: "고1",
        subject: "수학",
        main_textbook_title: "수학의 정석",
        main_textbook_publisher: "성지출판",
      },
    ],
    academicSupplementMaterials: [
      {
        id: "supplement-1",
        profile_id: "profile-math",
        title: "마플시너지",
      },
    ],
    selectedYear: "2026",
  });

  const row = model.rows.find((entry) => entry.schoolName === "사대부고" && entry.grade === "고1");
  assert.ok(row);

  const mathEntry = row.typeBuckets["수학시험일"][0];
  assert.ok(mathEntry);
  assert.equal(mathEntry.displaySections.find((section) => section.label === "부교재")?.items[0], "마플시너지");
  assert.deepEqual(mathEntry.subtextbookScopes, [
    {
      name: "마플시너지",
      publisher: "",
      scope: "1단원",
    },
  ]);
});
