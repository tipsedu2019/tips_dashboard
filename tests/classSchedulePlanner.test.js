import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCalendarDateToggle,
  buildSchedulePlanForSave,
  calculateSchedulePlan,
  getCalendarDaySurface,
  normalizeSchedulePlan,
} from '../src/lib/classSchedulePlanner.js';

test('normalizeSchedulePlan migrates legacy v1 data into v2 textbook session entries', () => {
  const normalized = normalizeSchedulePlan(
    {
      version: 1,
      selectedDays: [1],
      globalSessionCount: 2,
      billingPeriods: [
        {
          id: 'period-1',
          month: 3,
          startDate: '2026-03-02',
          endDate: '2026-03-09',
        },
      ],
      sessionStates: {},
    },
    {
      className: '중등 영어 A',
      subject: '영어',
      textbookIds: ['tb-main', 'tb-sub'],
      textbooks: [
        { id: 'tb-main', title: '주교재' },
        { id: 'tb-sub', title: '부교재' },
      ],
    }
  );

  assert.equal(normalized.version, 2);
  assert.equal(normalized.textbooks.length, 2);
  assert.deepEqual(
    normalized.textbooks.map((item) => ({
      textbookId: item.textbookId,
      order: item.order,
      role: item.role,
    })),
    [
      { textbookId: 'tb-main', order: 0, role: 'main' },
      { textbookId: 'tb-sub', order: 1, role: 'supplement' },
    ]
  );
  assert.equal(normalized.sessions.length, 2);
  assert.equal(normalized.sessions[0].textbookEntries.length, 2);
});

test('buildSchedulePlanForSave persists structured plan and actual progress per textbook', () => {
  const saved = buildSchedulePlanForSave(
    {
      version: 2,
      selectedDays: [1],
      globalSessionCount: 2,
      billingPeriods: [
        {
          id: 'period-1',
          month: 3,
          startDate: '2026-03-02',
          endDate: '2026-03-09',
        },
      ],
      textbooks: [
        { textbookId: 'tb-main', order: 0, role: 'main' },
      ],
      sessions: [
        {
          id: 'session-1',
          billingId: 'period-1',
          sessionNumber: 1,
          date: '2026-03-02',
          scheduleState: 'active',
          progressStatus: 'partial',
          textbookEntries: [
            {
              textbookId: 'tb-main',
              order: 0,
              plan: {
                rangeType: 'pages',
                start: '12',
                end: '19',
                memo: '독해 지문 1',
              },
              actual: {
                status: 'partial',
                rangeType: 'pages',
                start: '12',
                end: '15',
                publicNote: '15쪽까지 진행',
                teacherNote: '숙제 보강 필요',
              },
            },
          ],
        },
      ],
    },
    {
      className: '중등 영어 A',
      subject: '영어',
      textbookIds: ['tb-main'],
    }
  );

  assert.equal(saved.version, 2);
  assert.equal(saved.sessions.length, 2);
  assert.equal(saved.sessions[0].progressStatus, 'partial');
  assert.equal(saved.sessions[0].textbookEntries[0].plan.end, '19');
  assert.equal(saved.sessions[0].textbookEntries[0].actual.publicNote, '15쪽까지 진행');
  assert.ok(saved.history.length >= 1);
});

test('calculateSchedulePlan keeps session progress attached to session id when dates shift', () => {
  const before = normalizeSchedulePlan(
    {
      version: 2,
      selectedDays: [1],
      globalSessionCount: 2,
      billingPeriods: [
        {
          id: 'period-1',
          month: 3,
          startDate: '2026-03-02',
          endDate: '2026-03-09',
        },
      ],
      textbooks: [{ textbookId: 'tb-main', order: 0, role: 'main' }],
      sessions: [
        {
          id: 'session-1',
          billingId: 'period-1',
          sessionNumber: 1,
          date: '2026-03-02',
          scheduleState: 'active',
          progressStatus: 'done',
          textbookEntries: [
            {
              textbookId: 'tb-main',
              order: 0,
              plan: { rangeType: 'lessons', label: 'Lesson 1' },
              actual: { status: 'done', rangeType: 'lessons', label: 'Lesson 1' },
            },
          ],
        },
      ],
      sessionStates: {
        '2026-03-02': {
          state: 'exception',
          makeupDate: '2026-03-03',
        },
      },
    },
    {
      className: '중등 영어 A',
      subject: '영어',
      textbookIds: ['tb-main'],
    }
  );

  const calculated = calculateSchedulePlan(before);
  const shifted = calculated.sessions.find((session) => session.originalDate === '2026-03-02');

  assert.ok(shifted);
  assert.equal(shifted.id, 'session-1');
  assert.equal(shifted.textbookEntries[0].actual.status, 'done');
});

test('applyCalendarDateToggle cycles empty dates through normal, makeup, and clear', () => {
  const basePlan = normalizeSchedulePlan(
    {
      version: 2,
      selectedDays: [1],
      globalSessionCount: 4,
      billingPeriods: [
        {
          id: 'period-1',
          month: 4,
          startDate: '2026-04-01',
          endDate: '2026-04-30',
        },
      ],
      sessionStates: {},
    },
    {
      className: '대기고3',
      subject: '영어',
      textbookIds: [],
    }
  );

  const forcedPlan = applyCalendarDateToggle(basePlan, '2026-04-07', {
    hasSession: false,
    hasBaseSession: false,
  });
  assert.equal(forcedPlan.sessionStates['2026-04-07']?.state, 'force_active');

  const makeupPlan = applyCalendarDateToggle(forcedPlan, '2026-04-07', {
    hasSession: true,
    hasBaseSession: false,
  });
  assert.equal(makeupPlan.sessionStates['2026-04-07']?.state, 'makeup');

  const clearedPlan = applyCalendarDateToggle(makeupPlan, '2026-04-07', {
    hasSession: true,
    hasBaseSession: false,
  });
  assert.equal(clearedPlan.sessionStates['2026-04-07'], undefined);
});

test('calculateSchedulePlan keeps standalone makeup overrides as visible sessions', () => {
  const plan = normalizeSchedulePlan(
    {
      version: 2,
      selectedDays: [1],
      globalSessionCount: 4,
      billingPeriods: [
        {
          id: 'period-1',
          month: 4,
          startDate: '2026-04-01',
          endDate: '2026-04-30',
        },
      ],
      sessionStates: {
        '2026-04-07': {
          state: 'makeup',
        },
      },
    },
    {
      className: '대기고3',
      subject: '영어',
      textbookIds: [],
    }
  );

  const calculated = calculateSchedulePlan(plan);
  const session = calculated.sessions.find((entry) => entry.date === '2026-04-07');

  assert.ok(session);
  assert.equal(session.state, 'makeup');
  assert.equal(session.isForced, true);
});

test('normalizeSchedulePlan preserves an intentionally cleared billing period list', () => {
  const normalized = normalizeSchedulePlan(
    {
      version: 2,
      selectedDays: [1, 3],
      globalSessionCount: 8,
      billingPeriods: [],
      sessionStates: {},
    },
    {
      className: '대기고3',
      subject: '영어',
      textbookIds: [],
    },
  );

  assert.deepEqual(normalized.billingPeriods, []);
  assert.deepEqual(normalized.sessions, []);
});

test('normalizeSchedulePlan assigns pastel month colors that do not collide with state colors', () => {
  const normalized = normalizeSchedulePlan(
    {
      version: 2,
      selectedDays: [1],
      globalSessionCount: 4,
      billingPeriods: [
        {
          id: 'period-1',
          month: 5,
          startDate: '2026-05-01',
          endDate: '2026-05-31',
        },
        {
          id: 'period-2',
          month: 6,
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        },
        {
          id: 'period-3',
          month: 7,
          startDate: '2026-07-01',
          endDate: '2026-07-31',
        },
      ],
      sessionStates: {},
    },
    {
      className: '대기고3',
      subject: '영어',
      textbookIds: [],
    },
  );

  const colors = normalized.billingPeriods.map((period) => period.color);

  assert.equal(new Set(colors).size, colors.length);
  assert.ok(colors.every((color) => !['#dc2626', '#d97706', '#2563eb'].includes(color)));
});

test('getCalendarDaySurface fills only active dates and uses distinct state colors', () => {
  assert.deepEqual(getCalendarDaySurface(null, '#2563eb'), {
    isFilled: false,
    fillColor: 'transparent',
    textColor: '#94a3b8',
    mutedTextColor: '#cbd5e1',
  });

  assert.deepEqual(getCalendarDaySurface({ state: 'active' }, '#2563eb'), {
    isFilled: true,
    fillColor: '#2563eb',
    textColor: '#ffffff',
    mutedTextColor: 'rgba(255, 255, 255, 0.82)',
  });

  assert.deepEqual(getCalendarDaySurface({ state: 'exception' }, '#2563eb'), {
    isFilled: true,
    fillColor: '#dc2626',
    textColor: '#ffffff',
    mutedTextColor: 'rgba(255, 255, 255, 0.82)',
  });

  assert.deepEqual(getCalendarDaySurface({ state: 'tbd' }, '#2563eb'), {
    isFilled: true,
    fillColor: '#d97706',
    textColor: '#ffffff',
    mutedTextColor: 'rgba(255, 255, 255, 0.82)',
  });

  assert.deepEqual(getCalendarDaySurface({ state: 'makeup' }, '#2563eb'), {
    isFilled: true,
    fillColor: '#2563eb',
    textColor: '#ffffff',
    mutedTextColor: 'rgba(255, 255, 255, 0.82)',
  });
});
