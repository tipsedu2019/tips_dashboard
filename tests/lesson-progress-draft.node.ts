import test from "node:test";
import assert from "node:assert/strict";

import {
  createLessonProgressDraft,
  updateLessonProgressDraftEntry,
} from "../src/features/operations/lesson-progress-draft.ts";

test("editing a progress draft does not mutate session entries", () => {
  const entries = [
    { id: "math-1", planStart: "p.1", planEnd: "p.5", planLabel: "1단원", planMemo: "" },
  ];
  const draft = createLessonProgressDraft(entries);
  const changed = updateLessonProgressDraftEntry(draft, "math-1", "planEnd", "p.7");

  assert.equal(entries[0].planEnd, "p.5");
  assert.equal(changed[0].planEnd, "p.7");
});

test("updating one entry preserves the other textbook entries", () => {
  const draft = createLessonProgressDraft([
    { id: "a", planStart: "1", planEnd: "2", planLabel: "A", planMemo: "" },
    { id: "b", planStart: "3", planEnd: "4", planLabel: "B", planMemo: "" },
  ]);
  const changed = updateLessonProgressDraftEntry(draft, "a", "planLabel", "변경");

  assert.deepEqual(changed[1], draft[1]);
});
