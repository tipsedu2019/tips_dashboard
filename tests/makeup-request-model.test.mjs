import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMakeupRequestToSchedulePlan,
  buildMakeupCalendarDrafts,
  buildRoomAvailability,
  buildRoomOptions,
  canTransitionMakeupRequest,
  getAllowedApproverNames,
  resolveMakeupApprovalGroup,
} from "../src/features/makeup-requests/makeup-request-model.js";

test("makeup request approvers are restricted by subject and division", () => {
  assert.equal(resolveMakeupApprovalGroup({ subject: "수학", grade: "중2" }), "math_middle");
  assert.deepEqual(getAllowedApproverNames({ subject: "수학", grade: "중2" }), ["강정은"]);

  assert.equal(resolveMakeupApprovalGroup({ subject: "수학", grade: "초6" }), "math_middle");
  assert.deepEqual(getAllowedApproverNames({ subject: "수학", grade: "초6" }), ["강정은"]);

  assert.equal(resolveMakeupApprovalGroup({ subject: "수학", grade: "고1" }), "math_high");
  assert.deepEqual(getAllowedApproverNames({ subject: "수학", grade: "고1" }), ["양소윤"]);

  assert.equal(resolveMakeupApprovalGroup({ subject: "영어", grade: "고2" }), "english");
  assert.deepEqual(getAllowedApproverNames({ subject: "영어", grade: "고2" }), ["강부희", "김민경", "정보영"]);
});

test("makeup request workflow auto-completes on approver approval without a manager handoff", () => {
  assert.equal(canTransitionMakeupRequest("approval_pending", "completed", { isApprover: true }), true);
  assert.equal(canTransitionMakeupRequest("approval_pending", "manager_pending", { isApprover: true }), false);
  assert.equal(canTransitionMakeupRequest("approval_pending", "manager_pending", { isManager: true }), false);
  assert.equal(canTransitionMakeupRequest("manager_pending", "completed", { isManager: true }), false);
  assert.equal(canTransitionMakeupRequest("manager_pending", "completed", { isApprover: true }), false);
  assert.equal(canTransitionMakeupRequest("completed", "canceled", { isApprover: true }), true);
  assert.equal(canTransitionMakeupRequest("completed", "canceled", { isManager: true }), false);
  assert.equal(canTransitionMakeupRequest("completed", "canceled", { isRequester: true }), false);
  assert.equal(canTransitionMakeupRequest("makeup_pending", "completed", { isApprover: true }), true);
  assert.equal(canTransitionMakeupRequest("makeup_pending", "canceled", { isApprover: true }), true);
  assert.equal(canTransitionMakeupRequest("makeup_pending", "approval_pending", { isRequester: true }), true);
  assert.equal(canTransitionMakeupRequest("makeup_pending", "refund_pending", { isRequester: true }), false);
  assert.equal(canTransitionMakeupRequest("makeup_pending", "refund_pending", { isManager: true }), false);
  assert.equal(canTransitionMakeupRequest("approval_pending", "refund_pending", { isApprover: true }), true);
  assert.equal(canTransitionMakeupRequest("revision_requested", "approval_pending", { isRequester: true }), true);
  assert.equal(canTransitionMakeupRequest("refund_pending", "approval_pending", { isRequester: true }), false);
  assert.equal(canTransitionMakeupRequest("refund_pending", "completed", { isManager: true }), true);
  assert.equal(canTransitionMakeupRequest("refund_pending", "completed", { isApprover: true }), false);
  assert.equal(canTransitionMakeupRequest("refund_pending", "completed", { isRequester: true }), false);
  assert.equal(canTransitionMakeupRequest("completed", "approval_pending", { isManager: true }), false);
});

test("room availability blocks regular classes pending requests and calendar events", () => {
  const availability = buildRoomAvailability({
    classrooms: [{ name: "본관 2강" }, { name: "본관 3강" }, { name: "별관 5강" }],
    classes: [
      {
        id: "class-1",
        name: "중2 수학 A",
        subject: "수학",
        teacher: "정규쌤",
        room: "본관 2강",
        schedule: "월 18:00-20:00",
      },
    ],
    requests: [
      {
        id: "request-1",
        status: "approval_pending",
        className: "고1 영어",
        makeupClassroom: "본관 3강",
        makeupStartAt: "2026-07-06T18:30:00+09:00",
        makeupEndAt: "2026-07-06T20:00:00+09:00",
      },
    ],
    academicEvents: [
      {
        id: "event-1",
        title: "[보강] 고2 수학 · 별관 5강",
        type: "팁스",
        note: '[[TIPS_MAKEUP]] {"kind":"makeup","requestId":"old","classroom":"별관 5강","startAt":"2026-07-06T19:00:00+09:00","endAt":"2026-07-06T20:30:00+09:00"}',
      },
    ],
    startAt: "2026-07-06T19:00:00+09:00",
    endAt: "2026-07-06T20:00:00+09:00",
  });

  assert.deepEqual(
    availability.map((room) => ({
      room: room.name,
      available: room.available,
      collisions: room.collisions.map((collision) => collision.source),
    })),
    [
      { room: "본관 2강", available: false, collisions: ["regular_class"] },
      { room: "본관 3강", available: false, collisions: ["makeup_request"] },
      { room: "별관 5강", available: false, collisions: ["academic_event"] },
    ],
  );
});

test("room availability can ignore orphaned makeup calendar events for operators with a complete request list", () => {
  const availability = buildRoomAvailability({
    classrooms: [{ name: "별관 4강" }],
    requests: [],
    academicEvents: [
      {
        id: "event-1",
        title: "[보강] 수능대비반1 · 별관 4강",
        type: "팁스",
        note: '[[TIPS_MAKEUP]] {"kind":"makeup","requestId":"deleted-request","classroom":"별관 4강","startAt":"2026-10-26T09:00:00+09:00","endAt":"2026-10-26T11:00:00+09:00"}',
      },
    ],
    slots: [
      {
        startAt: "2026-10-26T09:00:00+09:00",
        endAt: "2026-10-26T11:00:00+09:00",
        classroom: "별관 4강",
      },
    ],
    ignoreOrphanedMakeupEvents: true,
  });

  assert.deepEqual(availability, [
    {
      name: "별관 4강",
      available: true,
      collisions: [],
    },
  ]);
});

test("room availability checks every makeup slot before recommending a room", () => {
  const availability = buildRoomAvailability({
    classrooms: [{ name: "본관 2강" }, { name: "본관 3강" }],
    classes: [
      {
        id: "class-1",
        name: "중2 수학 A",
        subject: "수학",
        room: "본관 2강",
        schedule: "월 18:00-19:00",
      },
    ],
    requests: [
      {
        id: "request-1",
        status: "manager_pending",
        className: "중3 영어",
        makeupClassroom: "본관 3강",
        makeupSlots: [
          {
            startAt: "2026-07-07T20:00:00+09:00",
            endAt: "2026-07-07T21:00:00+09:00",
          },
        ],
      },
    ],
    slots: [
      {
        startAt: "2026-07-06T18:30:00+09:00",
        endAt: "2026-07-06T19:00:00+09:00",
      },
      {
        startAt: "2026-07-07T20:30:00+09:00",
        endAt: "2026-07-07T21:00:00+09:00",
      },
    ],
  });

  assert.deepEqual(
    availability.map((room) => ({
      room: room.name,
      available: room.available,
      collisions: room.collisions.map((collision) => collision.source),
    })),
    [
      { room: "본관 2강", available: false, collisions: ["regular_class"] },
      { room: "본관 3강", available: false, collisions: ["makeup_request"] },
    ],
  );
});

test("room options are narrowed by the selected subject", () => {
  assert.deepEqual(
    buildRoomOptions(
      [
        { name: "영어 1강", subjects: ["영어"] },
        { name: "수학 1강", subjects: ["수학"] },
        { name: "공용 1강", subjects: ["영어", "수학"] },
      ],
      [
        { id: "english-class", subject: "영어", classroom: "영어 보조실" },
        { id: "math-class", subject: "수학", classroom: "수학 보조실" },
      ],
      { subject: "수학" },
    ),
    ["수학 1강", "공용 1강", "수학 보조실"],
  );
});

test("approved makeup request reflects cancellation and makeup into schedule plan", () => {
  const reflected = applyMakeupRequestToSchedulePlan(
    {
      subject: "수학",
      className: "중2 수학 A",
      selectedDays: [1],
      billingPeriods: [
        {
          id: "2026-07",
          month: 7,
          label: "7월",
          startDate: "2026-07-06",
          endDate: "2026-07-20",
        },
      ],
      textbooks: [{ textbookId: "book-1", alias: "RPM" }],
      sessions: [],
    },
    { subject: "수학", name: "중2 수학 A", schedule: "월 18:00-20:00" },
    {
      id: "request-1",
      reason: "학교 행사",
      cancelDate: "2026-07-06",
      makeupStartAt: "2026-07-08T19:00:00+09:00",
      makeupEndAt: "2026-07-08T21:00:00+09:00",
      makeupSlots: [
        {
          startAt: "2026-07-08T19:00:00+09:00",
          endAt: "2026-07-08T20:00:00+09:00",
        },
        {
          startAt: "2026-07-09T20:00:00+09:00",
          endAt: "2026-07-09T21:00:00+09:00",
          classroom: "별관 7강",
        },
      ],
      makeupClassroom: "본관 3강",
    },
  );

  assert.equal(reflected.sessionStates["2026-07-06"].state, "exception");
  assert.equal(reflected.sessionStates["2026-07-06"].makeupDate, "2026-07-08");
  assert.match(reflected.sessionStates["2026-07-06"].makeupMemo, /본관 3강/);
  assert.match(reflected.sessionStates["2026-07-06"].makeupMemo, /별관 7강/);
  assert.ok(reflected.sessions.some((session) => session.scheduleState === "makeup" && session.date === "2026-07-08"));
  assert.ok(reflected.sessions.some((session) => session.scheduleState === "makeup" && session.date === "2026-07-09"));
  assert.ok(reflected.sessions.some((session) => Array.isArray(session.textbookEntries)));
});

test("approved cancel-only request marks the canceled class date without completing a makeup session", () => {
  const reflected = applyMakeupRequestToSchedulePlan(
    {
      subject: "영어",
      className: "수능대비반1",
      selectedDays: [0],
      billingPeriods: [
        {
          id: "2026-10",
          month: 10,
          label: "10월",
          startDate: "2026-10-25",
          endDate: "2026-10-31",
        },
      ],
      sessionStates: {},
      sessions: [],
    },
    { subject: "영어", name: "수능대비반1", schedule: "일 12:00-14:00" },
    {
      id: "request-cancel-only",
      requestKind: "cancel_only",
      reason: "상담 일정",
      cancelDate: "2026-10-25",
      makeupSlots: [],
      makeupClassroom: "",
    },
  );

  assert.equal(reflected.sessionStates["2026-10-25"].state, "exception");
  assert.equal(reflected.sessionStates["2026-10-25"].memo, "휴강: 상담 일정");
  assert.equal(reflected.sessionStates["2026-10-25"].makeupMemo, "");
  assert.equal(reflected.sessionStates["2026-10-25"].makeupDate, "");
  assert.ok(!Object.values(reflected.sessionStates).some((state) => state.state === "makeup"));
});

test("approved makeup-only request adds makeup sessions without requiring a cancel date", () => {
  const reflected = applyMakeupRequestToSchedulePlan(
    {
      subject: "영어",
      className: "수능대비반1",
      selectedDays: [0],
      billingPeriods: [
        {
          id: "2026-10",
          month: 10,
          label: "10월",
          startDate: "2026-10-25",
          endDate: "2026-10-31",
        },
      ],
      sessionStates: {},
      sessions: [],
    },
    { subject: "영어", name: "수능대비반1", schedule: "일 12:00-14:00" },
    {
      id: "request-makeup-only",
      requestKind: "makeup_only",
      reason: "특강 보강",
      cancelDate: "",
      makeupSlots: [
        {
          startAt: "2026-10-26T09:00:00+09:00",
          endAt: "2026-10-26T11:00:00+09:00",
          classroom: "별관 4강",
        },
      ],
      makeupClassroom: "별관 4강",
    },
  );

  assert.equal(reflected.sessionStates["2026-10-26"].state, "makeup");
  assert.match(reflected.sessionStates["2026-10-26"].memo, /수능대비반1/);
  assert.ok(!Object.prototype.hasOwnProperty.call(reflected.sessionStates, ""));
  assert.ok(reflected.sessions.some((session) => session.scheduleState === "makeup" && session.date === "2026-10-26"));
});

test("makeup calendar drafts are idempotent and include machine-readable metadata for every makeup slot", () => {
  const drafts = buildMakeupCalendarDrafts({
    id: "request-1",
    className: "중2 수학 A",
    subject: "수학",
    cancelDate: "2026-07-06",
    makeupStartAt: "2026-07-08T19:00:00+09:00",
    makeupEndAt: "2026-07-08T21:00:00+09:00",
    makeupSlots: [
      {
        startAt: "2026-07-08T19:00:00+09:00",
        endAt: "2026-07-08T20:00:00+09:00",
      },
      {
        startAt: "2026-07-09T20:00:00+09:00",
        endAt: "2026-07-09T21:00:00+09:00",
        classroom: "별관 7강",
      },
    ],
    makeupClassroom: "본관 3강",
    reason: "학교 행사",
  });

  assert.deepEqual(drafts.map((draft) => draft.title), ["[휴강] 중2 수학 A", "[보강] 중2 수학 A · 본관 3강", "[보강] 중2 수학 A · 별관 7강"]);
  assert.deepEqual(drafts.map((draft) => draft.type), ["팁스", "팁스", "팁스"]);
  assert.deepEqual(drafts.map((draft) => draft.start), ["2026-07-06", "2026-07-08", "2026-07-09"]);
  assert.match(drafts[1].note, /"classroom":"본관 3강"/);
  assert.match(drafts[1].note, /"requestId":"request-1"/);
  assert.match(drafts[2].note, /"classroom":"별관 7강"/);
  assert.match(drafts[2].note, /"slotIndex":1/);
});

test("makeup calendar drafts match cancel-only and makeup-only request kinds", () => {
  const cancelOnlyDrafts = buildMakeupCalendarDrafts({
    id: "request-cancel-only",
    requestKind: "cancel_only",
    className: "수능대비반1",
    subject: "영어",
    cancelDate: "2026-10-25",
    reason: "상담 일정",
  });
  const makeupOnlyDrafts = buildMakeupCalendarDrafts({
    id: "request-makeup-only",
    requestKind: "makeup_only",
    className: "수능대비반1",
    subject: "영어",
    makeupSlots: [
      {
        startAt: "2026-10-26T09:00:00+09:00",
        endAt: "2026-10-26T11:00:00+09:00",
        classroom: "별관 4강",
      },
    ],
    makeupClassroom: "별관 4강",
    reason: "특강 보강",
  });

  assert.deepEqual(cancelOnlyDrafts.map((draft) => draft.title), ["[휴강] 수능대비반1"]);
  assert.match(cancelOnlyDrafts[0].note, /"kind":"cancel"/);
  assert.deepEqual(makeupOnlyDrafts.map((draft) => draft.title), ["[보강] 수능대비반1 · 별관 4강"]);
  assert.match(makeupOnlyDrafts[0].note, /"kind":"makeup"/);
});
