import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademicAnnualBoardModel,
  buildAcademicCalendarTemplateModel,
} from "../v2/src/features/operations/academic-calendar-models.js";

test("buildAcademicCalendarTemplateModel expands multi-day academic events and keeps legacy types out of admin UI", () => {
  const model = buildAcademicCalendarTemplateModel({
    academicEvents: [
      {
        id: "event-1",
        title: "중간고사",
        school_id: "school-1",
        type: "시험기간",
        start: "2026-04-21",
        end: "2026-04-23",
        grade: "고1",
        note: "시험 범위 공지",
      },
      {
        id: "event-2",
        title: "설명회",
        school_id: "school-1",
        type: "설명회",
        start: "2026-04-25",
        end: "2026-04-25",
        grade: "all",
      },
    ],
    academicSchools: [{ id: "school-1", name: "중앙고", category: "high" }],
  });

  assert.equal(model.events.length, 2);
  assert.equal(model.eventDates.length, 4);
  assert.equal(model.events[0].schoolName, "중앙고");
  assert.equal(model.events[0].sourceId, "event-1");
  assert.equal(model.events[0].typeLabel, "시험기간");
  assert.equal(model.events[0].date.toISOString().slice(0, 10), "2026-04-21");
  assert.equal(model.events[0].endDate.toISOString().slice(0, 10), "2026-04-23");
  assert.equal(model.events[1].title, "설명회");
  assert.equal(model.events[1].typeLabel, "팁스");
});

test("buildAcademicCalendarTemplateModel understands raw db rows that use date and embedded note metadata", () => {
  const model = buildAcademicCalendarTemplateModel({
    academicEvents: [
      {
        id: "db-event-1",
        title: "동중 기말고사",
        school_id: "school-1",
        type: "시험기간",
        date: "2026-07-06",
        note: "[[TIPS_META]]{\"rangeEnd\":\"2026-07-08\",\"academicYear\":2026}",
      },
    ],
    academicSchools: [{ id: "school-1", name: "동중", category: "middle" }],
  });

  assert.equal(model.events.length, 1);
  assert.equal(model.events[0].schoolName, "동중");
  assert.equal(model.events[0].date.toISOString().slice(0, 10), "2026-07-06");
  assert.equal(model.events[0].endDate.toISOString().slice(0, 10), "2026-07-08");
  assert.deepEqual(
    model.eventDates.map((entry) => ({
      year: entry.date.getFullYear(),
      month: entry.date.getMonth(),
      date: entry.date.getDate(),
    })),
    [
      { year: 2026, month: 6, date: 6 },
      { year: 2026, month: 6, date: 7 },
      { year: 2026, month: 6, date: 8 },
    ],
  );
});

test("buildAcademicAnnualBoardModel groups school events into month buckets with canonical type labels", () => {
  const model = buildAcademicAnnualBoardModel({
    academicEvents: [
      {
        id: "event-1",
        title: "중간고사",
        school_id: "school-1",
        type: "시험기간",
        start: "2026-04-21",
        end: "2026-04-23",
        grade: "고1",
      },
      {
        id: "event-2",
        title: "설명회",
        school_id: "school-1",
        type: "설명회",
        start: "2026-09-12",
        end: "2026-09-12",
        grade: "고1",
      },
      {
        id: "event-3",
        title: "체험학습",
        school_id: "school-2",
        type: "학교행사",
        start: "2026-04-10",
        end: "2026-04-10",
        grade: "중2",
      },
    ],
    academicSchools: [
      { id: "school-1", name: "중앙고", category: "high" },
      { id: "school-2", name: "대치중", category: "middle" },
    ],
    selectedYear: "2026",
  });

  assert.deepEqual(model.yearOptions, ["2026"]);
  assert.deepEqual(model.boardTypes, ["시험기간", "영어시험일", "수학시험일", "체험학습", "방학·휴일·기타", "팁스"]);
  assert.equal(model.rows.length, 2);
  assert.equal(model.summary.schoolCount, 2);
  assert.equal(model.summary.eventCount, 3);
  assert.equal(model.summary.activeTypeCount, 3);
  const centralHigh = model.rows.find((row) => row.schoolName === "중앙고");
  const daechiMiddle = model.rows.find((row) => row.schoolName === "대치중");
  assert.ok(centralHigh);
  assert.ok(daechiMiddle);
  assert.equal(centralHigh.typeBuckets["시험기간"][0].dateLabel, "2026-04-21 ~ 2026-04-23");
  assert.equal(centralHigh.typeBuckets["팁스"][0].title, "설명회");
  assert.equal(centralHigh.typeBuckets["팁스"][0].type, "팁스");
  assert.equal(daechiMiddle.typeBuckets["체험학습"][0].title, "체험학습");
});
