import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildAcademicAnnualBoardModel } from "../v2/src/features/operations/academic-calendar-models.js";

const root = process.cwd().endsWith("/v2") ? path.resolve(process.cwd(), "..") : process.cwd();

test("annual board keeps TIPS events in the school-grade operating board", () => {
  const model = buildAcademicAnnualBoardModel({
    academicEvents: [
      {
        id: "tips-briefing",
        title: "고1 설명회",
        school_id: "school-1",
        type: "설명회",
        start: "2026-09-12",
        end: "2026-09-12",
        grade: "고1",
      },
    ],
    academicSchools: [{ id: "school-1", name: "중앙고", category: "high" }],
    selectedYear: "2026",
  });

  assert.ok(model.boardTypes.includes("팁스"));
  assert.equal(model.summary.eventCount, 1);
  assert.equal(model.summary.activeTypeCount, 1);
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].typeBuckets["팁스"][0].title, "고1 설명회");
  assert.equal(model.rows[0].searchText.includes("고1 설명회"), true);
});

test("annual board workspace exposes a compact TIPS event row", () => {
  const source = readFileSync(
    path.join(root, "v2/src/features/operations/academic-annual-board-workspace.tsx"),
    "utf8",
  );

  assert.match(source, /type: "체험학습" \| "방학·휴일·기타" \| "팁스"/);
  assert.match(source, /\{ key: "tips", label: "팁스", kind: "event", type: "팁스" \}/);
  assert.match(source, /return "팁스 일정"/);
  assert.match(source, /if \(type === "팁스"\) return "팁스"/);
});
