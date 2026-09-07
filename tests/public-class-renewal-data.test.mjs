import assert from "node:assert/strict";
import test from "node:test";

import { publicClassSchedule } from "../src/lib/public-class-schedule.js";
import {
  createPublicClassCatalogLoader,
} from "../src/server/public-class-catalog.ts";
import {
  createPublicClassDetailLoader,
  createPublicClassDetailResponder,
  normalizePublicClassDetail,
  PublicClassNotFoundError,
  PublicClassUnavailableError,
  queryPublicClassDetail,
} from "../src/server/public-class-detail.ts";
import {
  PUBLIC_CLASSES_FULL_CACHE_TAG,
  PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS,
} from "../src/server/public-classes-cache.js";

const CLASS_ID = "b6b5da5a-b000-4b46-bc7a-dabea5b53e12";
const PRIVATE_CLASS_ID = "c6b5da5a-b000-4b46-bc7a-dabea5b53e13";
const BOOK_ID = "4d1b5f40-4a75-46af-b2ff-78c4431f259b";
const OTHER_BOOK_ID = "7b32685d-6952-45ac-8b13-519b8e208c9c";
const PRIVATE_CANARY = "PRIVATE_STUDENT_OR_STAFF_DATA";

function classRow(overrides = {}) {
  return {
    id: CLASS_ID,
    name: "초6 중등과정반1",
    subject: "수학",
    grade: "초6",
    teacher: "담당 선생님",
    room: "본관 1강",
    schedule: "월금 17:00-19:00",
    status: "수강",
    fee: 300000,
    capacity: 10,
    student_ids: [PRIVATE_CANARY, "private-student-2"],
    waitlist_ids: [PRIVATE_CANARY],
    textbook_ids: [BOOK_ID],
    lessons: [{ id: "lesson-1", title: "공개 단원", memo: PRIVATE_CANARY }],
    schedule_plan: {
      version: 2,
      history: [{ memo: PRIVATE_CANARY }],
      billingPeriods: [{
        id: "period-september",
        label: "9월 수강 구간",
        startDate: "2026-08-31",
        endDate: "2026-09-28",
        totalSessions: 8,
        internalState: PRIVATE_CANARY,
      }],
      textbooks: [{ textbookId: BOOK_ID, role: "main", alias: "개념+유형" }],
      sessions: [
        {
          id: "session-cancelled",
          date: "2026-09-25",
          scheduleState: "cancelled",
          originalDate: "2026-09-25",
          startTime: "17:00",
          endTime: "19:00",
          billingId: "period-september",
          billingLabel: "9월 수강 구간",
          publicNote: "휴강",
          teacherNote: PRIVATE_CANARY,
          studentIds: [PRIVATE_CANARY],
        },
        {
          id: "session-makeup",
          date: "2026-09-26",
          scheduleState: "makeup",
          makeupDate: "2026-09-26",
          originalDate: "2026-09-25",
          billingId: "period-september",
          billingLabel: "9월 수강 구간",
          sessionNumber: 8,
          textbookEntries: [{
            textbookId: BOOK_ID,
            plan: { rangeType: "page", start: "42", end: "49" },
            actual: {
              rangeType: "page",
              start: "42",
              end: "47",
              status: "done",
              publicNote: "47쪽까지",
              teacherNote: PRIVATE_CANARY,
            },
          }],
        },
      ],
    },
    start_date: "2026-08-01",
    end_date: null,
    ...overrides,
  };
}

function textbookRow(id, title) {
  return {
    id,
    title,
    publisher: "출판사",
    price: 18000,
    tags: ["수학"],
    lessons: [],
    updated_at: "2026-09-01T00:00:00.000Z",
    supplierPhone: PRIVATE_CANARY,
  };
}

function progressRow(overrides = {}) {
  return {
    id: "progress-1",
    class_id: CLASS_ID,
    textbook_id: BOOK_ID,
    progress_key: "progress-key-1",
    session_id: "session-makeup",
    session_order: 8,
    status: "done",
    range_start: "42",
    range_end: "47",
    range_label: "42~47쪽",
    public_note: "47쪽까지",
    teacher_note: PRIVATE_CANARY,
    updated_at: "2026-09-26T11:00:00.000Z",
    ...overrides,
  };
}

function fullPayload(generatedAt = "2026-09-07T00:00:00.000Z") {
  return {
    generatedAt,
    source: "supabase",
    classes: [classRow()],
    textbooks: [
      textbookRow(BOOK_ID, "개념+유형 라이트 중1-1"),
      textbookRow(OTHER_BOOK_ID, "다른 수업 교재"),
    ],
    progressLogs: [
      progressRow(),
      progressRow({ id: "progress-other", class_id: PRIVATE_CLASS_ID }),
    ],
  };
}

class QueryBuilder {
  constructor(table, rows, errors, calls) {
    this.table = table;
    this.rows = rows;
    this.errors = errors;
    this.calls = calls;
    this.filters = [];
    this.single = false;
    this.call = { table, columns: "", filters: this.filters, retry: undefined, signal: null };
    calls.push(this.call);
  }

  select(columns) {
    this.call.columns = columns;
    return this;
  }

  eq(column, value) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  in(column, values) {
    this.filters.push(["in", column, [...values]]);
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  abortSignal(signal) {
    this.call.signal = signal;
    return this;
  }

  retry(value) {
    this.call.retry = value;
    return this;
  }

  then(resolve, reject) {
    if (this.errors[this.table]) {
      return Promise.resolve({ data: null, error: this.errors[this.table] }).then(resolve, reject);
    }
    let data = [...(this.rows[this.table] || [])];
    for (const [operator, column, value] of this.filters) {
      if (operator === "eq") data = data.filter((row) => row[column] === value);
      if (operator === "in") data = data.filter((row) => value.includes(row[column]));
    }
    return Promise.resolve({ data: this.single ? data[0] ?? null : data, error: null })
      .then(resolve, reject);
  }
}

function createSupabase(rows, errors = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        return new QueryBuilder(table, rows, errors, calls);
      },
    },
  };
}

function passthroughCache(calls = []) {
  return (loader, keys, options) => {
    calls.push({ keys, options });
    return (...args) => loader(...args);
  };
}

test("catalog exposes aggregate counts and distinguishes live, fresh snapshot, expired snapshot, and unavailable", async () => {
  const payload = fullPayload();
  const live = await createPublicClassCatalogLoader({
    loadLive: async () => payload,
    now: () => Date.parse("2026-09-07T00:05:00.000Z"),
  })();
  assert.equal(live.availability, "live");
  assert.equal(live.generatedAt, payload.generatedAt);
  assert.equal(live.classes[0].enrolledCount, 2);
  assert.equal(live.classes[0].waitlistCount, 1);
  assert.doesNotMatch(JSON.stringify(live), /student_ids|waitlist_ids|PRIVATE_/);

  const snapshot = await createPublicClassCatalogLoader({
    loadLive: async () => { throw new Error("database unavailable"); },
    readSnapshot: async () => payload,
    now: () => Date.parse("2026-09-07T12:00:00.000Z"),
  })();
  assert.equal(snapshot.availability, "snapshot");
  assert.equal(snapshot.classes.length, 1);

  let oldCachedSnapshotReads = 0;
  const oldCached = await createPublicClassCatalogLoader({
    loadLive: async () => payload,
    readSnapshot: async () => {
      oldCachedSnapshotReads += 1;
      return null;
    },
    now: () => Date.parse("2026-09-07T12:00:00.000Z"),
  })();
  assert.equal(oldCached.availability, "snapshot");
  assert.equal(oldCached.generatedAt, payload.generatedAt);
  assert.equal(oldCachedSnapshotReads, 0);

  for (const generatedAt of [
    "2026-09-05T11:59:59.999Z",
    undefined,
  ]) {
    const stale = await createPublicClassCatalogLoader({
      loadLive: async () => null,
      readSnapshot: async () => ({ ...payload, generatedAt }),
      now: () => Date.parse("2026-09-07T12:00:00.000Z"),
    })();
    assert.deepEqual(stale, {
      classes: [],
      generatedAt: null,
      availability: "unavailable",
    });
  }
});

test("selected detail queries one public class and only its related rows with bounded no-retry reads", async () => {
  const { client, calls } = createSupabase({
    classes: [classRow(), classRow({ id: PRIVATE_CLASS_ID, name: "다른 수업" })],
    progress_logs: [progressRow(), progressRow({ id: "progress-other", class_id: PRIVATE_CLASS_ID })],
    textbooks: [
      textbookRow(BOOK_ID, "개념+유형 라이트 중1-1"),
      textbookRow(OTHER_BOOK_ID, "다른 수업 교재"),
    ],
  });

  const detail = await queryPublicClassDetail(CLASS_ID, {
    env: {},
    supabaseClient: client,
    now: () => new Date("2026-09-07T03:00:00.000Z"),
  });

  assert.equal(detail.availability, "live");
  assert.equal(detail.classItem.id, CLASS_ID);
  assert.deepEqual(detail.textbooks.map((book) => book.id), [BOOK_ID]);
  assert.deepEqual(detail.progressLogs.map((log) => log.id), ["progress-1"]);
  assert.deepEqual(calls.map((call) => call.table), ["classes", "progress_logs", "textbooks"]);
  assert.deepEqual(calls[0].filters, [["eq", "id", CLASS_ID]]);
  assert.deepEqual(calls[1].filters, [["eq", "class_id", CLASS_ID]]);
  assert.deepEqual(calls[2].filters, [["in", "id", [BOOK_ID]]]);
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
  assert.equal(new Set(calls.map((call) => call.signal)).size, 1);
  assert.ok(calls.every((call) => call.retry === false));

  const json = JSON.stringify(detail);
  assert.doesNotMatch(json, /student_ids|waitlist_ids|teacher_note|history|PRIVATE_/);
  assert.equal(detail.classItem.enrolledCount, 2);
  assert.equal(detail.classItem.waitlistCount, 1);
  assert.deepEqual(detail.classItem.schedulePlan.billingPeriods, [{
    id: "period-september",
    label: "9월 수강 구간",
    startDate: "2026-08-31",
    endDate: "2026-09-28",
    sessionCount: 1,
  }]);
  const [cancelled, makeup] = detail.classItem.schedulePlan.sessions;
  assert.deepEqual(
    [cancelled.scheduleState, cancelled.originalDate, cancelled.publicNote],
    ["cancelled", "2026-09-25", "휴강"],
  );
  assert.deepEqual(
    [makeup.scheduleState, makeup.makeupDate, makeup.originalDate, makeup.sessionNumber],
    ["makeup", "2026-09-26", "2026-09-25", 8],
  );
  assert.equal(makeup.textbookEntries[0].actual.publicNote, "47쪽까지");
  assert.equal(detail.progressLogs[0].rangeLabel, "42~47쪽");
  assert.equal(detail.progressLogs[0].publicNote, "47쪽까지");
});

test("planner auto-zero periods expose recorded active and makeup counts only", () => {
  const expectedCounts = [11, 12, 12, 12, 10];
  const billingPeriods = expectedCounts.map((_, index) => ({
    id: `period-${index + 1}`,
    label: `${index + 1}구간`,
    startDate: `2026-${String(index + 8).padStart(2, "0")}-01`,
    endDate: `2026-${String(index + 8).padStart(2, "0")}-28`,
    totalSessions: 0,
  }));
  const sessions = billingPeriods.flatMap((period, periodIndex) => {
    const count = expectedCounts[periodIndex];
    return [
      ...Array.from({ length: count - 1 }, (_, index) => ({
        id: `${period.id}-active-${index}`,
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        billingId: period.id,
        scheduleState: "active",
      })),
      {
        id: `${period.id}-makeup`,
        date: "2026-09-20",
        billingId: period.id,
        scheduleState: "makeup",
      },
      ...["exception", "tbd", "skipped", "cancelled"].map((scheduleState) => ({
        id: `${period.id}-${scheduleState}`,
        date: "2026-09-21",
        billingId: period.id,
        scheduleState,
      })),
    ];
  });

  const normalized = publicClassSchedule({
    version: 2,
    billingPeriods,
    sessions,
  });

  assert.deepEqual(
    normalized.billingPeriods.map((period) => period.sessionCount),
    expectedCounts,
  );
  assert.equal(
    normalized.sessions.filter((session) =>
      ["exception", "tbd", "skipped", "cancelled"].includes(session.scheduleState),
    ).length,
    expectedCounts.length * 4,
  );
});

test("unknown and non-public classes return not-found without related reads", async () => {
  for (const id of [CLASS_ID, PRIVATE_CLASS_ID]) {
    const rows = id === CLASS_ID ? [] : [classRow({ id, status: "종강" })];
    const { client, calls } = createSupabase({ classes: rows });
    await assert.rejects(
      queryPublicClassDetail(id, { env: {}, supabaseClient: client }),
      PublicClassNotFoundError,
    );
    assert.deepEqual(calls.map((call) => call.table), ["classes"]);
  }
});

test("database errors remain unavailable and never expose provider details", async () => {
  for (const [table, rows] of [
    ["classes", { classes: [classRow()] }],
    ["progress_logs", { classes: [classRow()], progress_logs: [] }],
  ]) {
    const { client } = createSupabase(rows, {
      [table]: new Error(`${PRIVATE_CANARY} provider failure`),
    });
    await assert.rejects(
      queryPublicClassDetail(CLASS_ID, { env: {}, supabaseClient: client }),
      (error) => error instanceof PublicClassUnavailableError &&
        !error.message.includes(PRIVATE_CANARY),
    );
  }
});

test("confirmed not-found never reappears from snapshot while provider errors use only a fresh matching snapshot", async () => {
  let snapshotReads = 0;
  const confirmedMissing = createPublicClassDetailLoader({
    loadLive: async () => { throw new PublicClassNotFoundError(); },
    readSnapshot: async () => {
      snapshotReads += 1;
      return fullPayload();
    },
    cache: passthroughCache(),
  });
  assert.deepEqual(await confirmedMissing(CLASS_ID), { status: "not-found" });
  assert.equal(snapshotReads, 0);

  const cachedCalls = [];
  const freshFallback = createPublicClassDetailLoader({
    loadLive: async () => { throw new PublicClassUnavailableError(); },
    readSnapshot: async () => fullPayload(),
    now: () => Date.parse("2026-09-07T12:00:00.000Z"),
    cache: passthroughCache(cachedCalls),
  });
  const fresh = await freshFallback(CLASS_ID);
  assert.equal(fresh.status, "success");
  assert.equal(fresh.detail.availability, "snapshot");
  assert.equal(fresh.detail.classItem.id, CLASS_ID);
  assert.deepEqual(fresh.detail.textbooks.map((book) => book.id), [BOOK_ID]);
  assert.deepEqual(fresh.detail.progressLogs.map((log) => log.id), ["progress-1"]);
  assert.deepEqual(cachedCalls, [{
    keys: ["public-class-detail-v1"],
    options: {
      revalidate: PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS,
      tags: [PUBLIC_CLASSES_FULL_CACHE_TAG],
    },
  }]);

  const expiredFallback = createPublicClassDetailLoader({
    loadLive: async () => { throw new Error("provider down"); },
    readSnapshot: async () => fullPayload("2026-09-06T11:59:59.999Z"),
    now: () => Date.parse("2026-09-07T12:00:00.000Z"),
    cache: passthroughCache(),
  });
  assert.deepEqual(await expiredFallback(CLASS_ID), { status: "unavailable" });
});

test("an aged cached detail is relabeled snapshot and cannot remain live through a failed refresh", async () => {
  const agedDetail = normalizePublicClassDetail(fullPayload(), CLASS_ID, "live");
  assert.ok(agedDetail);
  let snapshotReads = 0;
  const load = createPublicClassDetailLoader({
    loadLive: async () => agedDetail,
    readSnapshot: async () => {
      snapshotReads += 1;
      return null;
    },
    now: () => Date.parse("2026-09-07T12:00:00.000Z"),
    cache: passthroughCache(),
  });

  const result = await load(CLASS_ID);
  assert.equal(result.status, "success");
  assert.equal(result.detail.availability, "snapshot");
  assert.equal(result.detail.generatedAt, "2026-09-07T00:00:00.000Z");
  assert.equal(snapshotReads, 0);
});

test("detail failures are retried on later calls and HTTP responses separate 404, 503, and cacheable success", async () => {
  let attempts = 0;
  const load = createPublicClassDetailLoader({
    loadLive: async () => {
      attempts += 1;
      throw new PublicClassUnavailableError();
    },
    readSnapshot: async () => null,
    cache: passthroughCache(),
  });
  assert.equal((await load(CLASS_ID)).status, "unavailable");
  assert.equal((await load(CLASS_ID)).status, "unavailable");
  assert.equal(attempts, 2);

  const notFoundResponse = await createPublicClassDetailResponder(async () => ({
    status: "not-found",
  }))("bad-id");
  assert.equal(notFoundResponse.status, 404);
  assert.equal(notFoundResponse.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(notFoundResponse.body), { error: "public_class_not_found" });

  const unavailableResponse = await createPublicClassDetailResponder(async () => ({
    status: "unavailable",
  }))(CLASS_ID);
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.headers["Cache-Control"], "no-store");

  const snapshotLoader = createPublicClassDetailLoader({
    loadLive: async () => { throw new PublicClassUnavailableError(); },
    readSnapshot: async () => fullPayload(),
    now: () => Date.parse("2026-09-07T12:00:00.000Z"),
    cache: passthroughCache(),
  });
  const successResponse = await createPublicClassDetailResponder(snapshotLoader)(CLASS_ID);
  assert.equal(successResponse.status, 200);
  assert.equal(successResponse.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(successResponse.body).availability, "snapshot");

  const liveDetail = normalizePublicClassDetail(
    fullPayload("2026-09-07T11:59:00.000Z"),
    CLASS_ID,
    "live",
  );
  const liveResponse = await createPublicClassDetailResponder(async () => ({
    status: "success",
    detail: liveDetail,
  }))(CLASS_ID);
  assert.equal(liveResponse.status, 200);
  assert.equal(liveResponse.headers["Cache-Control"], "public, max-age=0, s-maxage=600");
});
