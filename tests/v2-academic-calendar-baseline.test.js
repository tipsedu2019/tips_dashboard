import test from "node:test";
import assert from "node:assert/strict";

import {
  getAcademicCalendarBaselineSnapshot,
  resolveAcademicCalendarCollections,
} from "../v2/src/features/operations/academic-calendar-baseline.js";

test("academic calendar baseline snapshot provides bundled schools and events", () => {
  const baseline = getAcademicCalendarBaselineSnapshot();

  assert.equal(baseline.academicCalendarSource, "seed");
  assert.ok(baseline.academicSchools.length >= 5);
  assert.ok(baseline.academicEvents.length >= 20);
  assert.equal(baseline.academicSchools[0].name.length > 0, true);
  assert.equal(baseline.academicEvents[0].school_id.length > 0, true);
  assert.match(baseline.academicEvents[0].start, /^\d{4}-\d{2}-\d{2}$/);
});

test("academic calendar baseline still includes historical source labels that must be normalized at the UI layer", () => {
  const baseline = getAcademicCalendarBaselineSnapshot();
  const typeLabels = new Set(baseline.academicEvents.map((event) => event.type));

  assert.equal(typeLabels.has("설명회"), true);
  assert.equal(typeLabels.has("방학"), true);
});

test("academic calendar collections fall back to bundled seeds only when both live tables are empty", () => {
  const fallback = resolveAcademicCalendarCollections({
    academicEvents: [],
    academicSchools: [],
  });

  assert.equal(fallback.academicCalendarSource, "seed");
  assert.ok(fallback.academicEvents.length > 0);
  assert.ok(fallback.academicSchools.length > 0);

  const live = resolveAcademicCalendarCollections({
    academicEvents: [{ id: "live-event" }],
    academicSchools: [],
  });

  assert.equal(live.academicCalendarSource, "live");
  assert.deepEqual(live.academicEvents, [{ id: "live-event" }]);
  assert.deepEqual(live.academicSchools, []);
});

test("academic calendar collections can opt out of bundled seeds for authenticated workspaces", () => {
  const liveEmpty = resolveAcademicCalendarCollections({
    academicEvents: [],
    academicSchools: [],
    allowSeed: false,
  });

  assert.equal(liveEmpty.academicCalendarSource, "live");
  assert.deepEqual(liveEmpty.academicEvents, []);
  assert.deepEqual(liveEmpty.academicSchools, []);
});
