import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Home,
  MapPin,
  MessageCircle,
  Moon,
  Share2,
  Star,
  Sun,
  Trophy,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { ACTIVE_CLASS_STATUS, computeClassStatus } from '../lib/classStatus';
import {
  CLASS_COLORS,
  generateTimeSlots,
  parseSchedule,
  stripClassPrefix,
} from '../data/sampleData';
import useViewport from '../hooks/useViewport';
import { useToast } from '../contexts/ToastContext';
import { captureElementAsPngBlob, downloadBlob } from '../lib/exportAsImage';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';
import BottomSheet from './ui/BottomSheet';
import TimetableGrid from './ui/TimetableGrid';
import { PublicClassLandingSkeleton } from './ui/PageLoader';
import { Badge, Button, IconButton, SearchField, Tab } from './ui/tds';

const PUBLIC_SUBJECT_TABS = ['영어', '수학'];
const PUBLIC_GRADE_TABS = ['고3', '고2', '고1', '중3', '중2', '중1', '초6'];
const DEFAULT_SUBJECT = '수학';
const DEFAULT_GRADE = '초6';

const PUBLIC_BOTTOM_NAV_ITEMS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'reviews', label: '리뷰', icon: Star },
  { id: 'classes', label: '수업', icon: BookOpen },
  { id: 'scores', label: '성적', icon: Trophy },
  { id: 'inquiry', label: '문의', icon: MessageCircle },
];
const PUBLIC_BOTTOM_NAV_IDS = new Set(PUBLIC_BOTTOM_NAV_ITEMS.map((item) => item.id));

const DAY_COLUMNS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_INDEX_MAP = Object.fromEntries(DAY_COLUMNS.map((day, index) => [day, index]));
const SLOT_START_HOUR = 6;
const SLOT_END_HOUR = 24;
const SLOT_START_MINUTES = SLOT_START_HOUR * 60;
const FULL_TIME_SLOTS = generateTimeSlots(SLOT_START_HOUR, SLOT_END_HOUR);
const DEFAULT_START_SLOT = 6;
const DEFAULT_END_SLOT = 28;
const CHANNEL_TALK_URL = 'https://tipsedu.channel.io/';
const EMBEDDED_PUBLIC_VIEW_URLS = {
  home: '/embedded/home/index.html',
  reviews: '/embedded/reviews/index.html',
  scores: '/embedded/scores/index.html',
};

const SUBJECT_TONES = {
  영어: { bg: 'var(--tds-color-red-50, #fff1f2)', border: 'var(--tds-color-red-200, #fecdd3)', text: 'var(--tds-color-red-600, #e11d48)' },
  수학: { bg: 'var(--tds-color-blue-50, #eff6ff)', border: 'var(--tds-color-blue-200, #bfdbfe)', text: 'var(--tds-color-blue-600, #2563eb)' },
};

const PLANNER_SUBJECT_TONES = {
  수학: {
    key: 'math',
    timetable: { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  },
  영어: {
    key: 'english',
    timetable: { bg: '#fff1f2', border: '#fda4af', text: '#be123c' },
  },
};

const PLANNER_FALLBACK_TONES = [
  { bg: '#eef2f7', border: '#d9e0e8', text: '#334155' },
  { bg: '#fff3e1', border: '#ffd7a0', text: '#9a5b00' },
  { bg: '#e8f7f1', border: '#c7ebdd', text: '#0c7a58' },
  { bg: '#f4f1ff', border: '#dfd3ff', text: '#5d3fd3' },
  { bg: '#ffeceb', border: '#ffc7c2', text: '#d14343' },
  { bg: '#eef3ff', border: '#d7e3ff', text: '#2f5dd7' },
];

const PLANNER_TIMETABLE_TONES = [
  {
    bg: '#eff6ff',
    border: '#93c5fd',
    text: '#1d4ed8',
  },
  {
    bg: '#eafaf6',
    border: '#62d5b5',
    text: '#0f766e',
  },
  {
    bg: '#ecfdf5',
    border: '#86efac',
    text: '#15803d',
  },
  {
    bg: '#fff7ed',
    border: '#fdba74',
    text: '#c2410c',
  },
  {
    bg: '#fff1f2',
    border: '#fda4af',
    text: '#be123c',
  },
];

function text(value) {
  return String(value || '').trim();
}

function normalizeGrade(value) {
  return text(value) || '미정';
}

function normalizeGradeToken(value) {
  return text(value).replace(/\s+/g, '');
}

function formatCurrency(amount) {
  const safe = Number(amount || 0);
  if (!Number.isFinite(safe) || safe <= 0) {
    return '수업료 문의';
  }
  return `${safe.toLocaleString('ko-KR')}원`;
}

function buildScheduleLines(classItem) {
  const slots = parseSchedule(classItem?.schedule, classItem) || [];
  if (slots.length === 0) {
    return ['시간 미정'];
  }

  const groupedByTime = new Map();

  slots.forEach((slot) => {
    const timeKey = `${slot.start}-${slot.end}`;
    const currentDays = groupedByTime.get(timeKey) || [];
    currentDays.push(slot.day);
    groupedByTime.set(timeKey, currentDays);
  });

  return [...groupedByTime.entries()].map(([timeKey, days]) => {
    const orderedDays = [...new Set(days)]
      .sort((left, right) => DAY_COLUMNS.indexOf(left) - DAY_COLUMNS.indexOf(right))
      .join('');

    return `${orderedDays} ${timeKey}`;
  });
}

function splitLines(value, limit = 2) {
  return text(value)
    .split(/[,\n]/)
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, limit);
}

function timeToMinutes(value) {
  const [hour, minute] = text(value).split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return Number.NaN;
  }
  return hour * 60 + minute;
}

function getSlotIndexForTimeValue(value) {
  const minutes = timeToMinutes(value);
  if (Number.isNaN(minutes)) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(FULL_TIME_SLOTS.length, Math.round((minutes - SLOT_START_MINUTES) / 30)),
  );
}

function getToneForClass(classItem, index = 0) {
  const subject = text(classItem?.subject);
  if (SUBJECT_TONES[subject]) {
    return SUBJECT_TONES[subject];
  }

  const fallback =
    PLANNER_FALLBACK_TONES[index % PLANNER_FALLBACK_TONES.length] ||
    CLASS_COLORS[index % CLASS_COLORS.length] ||
    CLASS_COLORS[0];

  return {
    bg: fallback.bg,
    border: fallback.border,
    text: fallback.text,
  };
}

function hashPlannerToneSeed(value = '') {
  return [...text(value)].reduce((accumulator, character) => {
    return (accumulator * 31 + character.charCodeAt(0)) >>> 0;
  }, 7);
}

function getPlannerToneForClass(classItem, index = 0) {
  const subject = text(classItem?.subject);
  if (PLANNER_SUBJECT_TONES[subject]) {
    return PLANNER_SUBJECT_TONES[subject].timetable;
  }

  const seed = [
    text(classItem?.id),
    text(classItem?.subject),
    normalizeGrade(classItem?.grade),
    stripClassPrefix(classItem?.className || classItem?.name || ''),
  ]
    .filter(Boolean)
    .join('|');

  const toneIndex = seed
    ? hashPlannerToneSeed(seed) % PLANNER_TIMETABLE_TONES.length
    : index % PLANNER_TIMETABLE_TONES.length;

  return PLANNER_TIMETABLE_TONES[toneIndex] || PLANNER_TIMETABLE_TONES[0];
}

function getPlannerSubjectToneKey(subject) {
  return PLANNER_SUBJECT_TONES[text(subject)]?.key || 'neutral';
}

function renderPlannerSubjectBadge(subject, className = '') {
  return (
    <span
      className={[
        'public-planner-subject-badge',
        `is-${getPlannerSubjectToneKey(subject)}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {text(subject) || '과목'}
    </span>
  );
}

function getClassSortKey(classItem) {
  return [
    stripClassPrefix(classItem?.className || classItem?.name || ''),
    text(classItem?.subject),
    normalizeGrade(classItem?.grade),
  ]
    .map((value) => text(value))
    .join(' ');
}

function getStatusMeta(classItem) {
  const capacity = Number(classItem?.capacity || 0);
  const enrolled = Array.isArray(classItem?.studentIds) ? classItem.studentIds.length : 0;
  const waitlist = Array.isArray(classItem?.waitlistIds) ? classItem.waitlistIds.length : 0;

  if (capacity > 0) {
    const seatsLeft = Math.max(0, capacity - enrolled);

    if (seatsLeft === 0) {
      return {
        priority: 0,
        tone: 'danger',
        badgeType: 'teal',
        label: '마감',
        detail: `대기 ${waitlist}명`,
      };
    }

    if (seatsLeft <= 3) {
      return {
        priority: 1,
        tone: 'warning',
        badgeType: 'red',
        label: '마감임박',
        detail: `마지막 ${seatsLeft}자리`,
      };
    }

    return {
      priority: 2,
      tone: 'accent',
      badgeType: 'green',
      label: '모집중',
      detail: '',
    };
  }

  return {
    priority: 3,
    tone: 'accent',
    badgeType: 'green',
    label: '모집중',
    detail: '',
  };
}

function getEnrollmentSummary(classItem) {
  const enrolled = Array.isArray(classItem?.studentIds) ? classItem.studentIds.length : 0;
  const capacity = Number(classItem?.capacity || 0);

  if (capacity > 0) {
    return `정원 ${enrolled}/${capacity}`;
  }

  return '정원 문의';
}

function getDisplayFee(classItem) {
  return Number(classItem?.fee || classItem?.tuition || 0);
}

function buildPlannerFieldText(value, fallback, limit = 3) {
  const lines = splitLines(value, limit);
  return lines.length ? lines.join(' · ') : fallback;
}

function sortClassesForLanding(items = []) {
  const subjectOrder = new Map(PUBLIC_SUBJECT_TABS.map((subject, index) => [subject, index]));
  const gradeOrder = new Map(PUBLIC_GRADE_TABS.map((grade, index) => [grade, index]));

  return items
    .slice()
    .sort((left, right) => {
      const subjectDiff =
        (subjectOrder.get(text(left?.subject)) ?? PUBLIC_SUBJECT_TABS.length) -
        (subjectOrder.get(text(right?.subject)) ?? PUBLIC_SUBJECT_TABS.length);

      if (subjectDiff !== 0) {
        return subjectDiff;
      }

      const gradeDiff =
        (gradeOrder.get(normalizeGrade(left?.grade)) ?? PUBLIC_GRADE_TABS.length) -
        (gradeOrder.get(normalizeGrade(right?.grade)) ?? PUBLIC_GRADE_TABS.length);

      if (gradeDiff !== 0) {
        return gradeDiff;
      }

      return getClassSortKey(left).localeCompare(getClassSortKey(right), 'ko');
    });
}

function buildSectionKicker(selectedSubject, selectedGrade) {
  const subjectLabel = selectedSubject ? (
    <Badge
      size="small"
      type={text(selectedSubject) === '수학' ? 'blue' : text(selectedSubject) === '영어' ? 'red' : 'gray'}
      badgeStyle="weak"
    >
      {selectedSubject}
    </Badge>
  ) : (
    '전체 과목'
  );

  const gradeLabel = selectedGrade || '전체 학년';

  return (
    <div className="public-landing-section-kicker-content">
      {subjectLabel}
      {selectedSubject && selectedGrade ? <span className="public-landing-section-kicker-sep"> · </span> : null}
      {gradeLabel}
    </div>
  );
}

function buildSectionTitle(selectedSubject, selectedGrade) {
  if (selectedGrade) {
    return `${selectedGrade} 수업`;
  }

  if (selectedSubject) {
    return `${selectedSubject} 수업`;
  }

  return '전체 수업';
}

function buildPlannerSummaryText(items = []) {
  if (!items.length) {
    return '';
  }

  const counts = items.reduce((accumulator, item) => {
    const subject = text(item?.subject) || '기타';
    accumulator.set(subject, (accumulator.get(subject) || 0) + 1);
    return accumulator;
  }, new Map());

  const subjectOrder = new Map(PUBLIC_SUBJECT_TABS.map((subject, index) => [subject, index]));

  return [...counts.entries()]
    .sort(
      ([leftSubject], [rightSubject]) =>
        (subjectOrder.get(leftSubject) ?? PUBLIC_SUBJECT_TABS.length) -
        (subjectOrder.get(rightSubject) ?? PUBLIC_SUBJECT_TABS.length),
    )
    .map(([subject, count]) => `${subject} ${count}개`)
    .join(', ');
}

function buildModalSummaryBadges(classItem, context = {}) {
  const badges = [];
  if (context.grade) {
    badges.push({ label: context.grade, tone: 'neutral' });
  }
  if (classItem?.subject) {
    badges.push({ label: classItem.subject, tone: 'accent' });
  }

  const statusMeta = getStatusMeta(classItem);
  badges.push({ label: statusMeta.label, tone: statusMeta.tone });
  if (statusMeta.detail) {
    badges.push({ label: statusMeta.detail, tone: 'neutral' });
  }

  return badges.slice(0, 4);
}

function buildTimetableData(items = []) {
  const entries = [];

  items.forEach((classItem, itemIndex) => {
    const parsedSlots = parseSchedule(classItem?.schedule, classItem) || [];
    parsedSlots.forEach((slot, slotIndex) => {
      const columnIndex = DAY_INDEX_MAP[slot.day];
      if (columnIndex === undefined) {
        return;
      }

      const startSlot = getSlotIndexForTimeValue(slot.start);
      const endSlot = getSlotIndexForTimeValue(slot.end);
      if (endSlot <= startSlot) {
        return;
      }

      entries.push({
        key: `${classItem.id || itemIndex}-${slot.day}-${slot.start}-${slot.end}-${slotIndex}`,
        classItem,
        columnIndex,
        startSlot,
        endSlot,
        scheduleLabel: `${slot.day} ${slot.start} - ${slot.end}`,
        tone: getPlannerToneForClass(classItem, itemIndex),
      });
    });
  });

  if (entries.length === 0) {
    return {
      timeSlots: FULL_TIME_SLOTS.slice(DEFAULT_START_SLOT, DEFAULT_END_SLOT),
      blocks: [],
    };
  }

  const mergedEntries = [];

  DAY_COLUMNS.forEach((_, columnIndex) => {
    const dayEntries = entries
      .filter((entry) => entry.columnIndex === columnIndex)
      .sort((left, right) => left.startSlot - right.startSlot || left.endSlot - right.endSlot);

    let cluster = [];
    let clusterEnd = -1;

    const flushCluster = () => {
      if (cluster.length === 0) {
        return;
      }

      const clusterStart = Math.min(...cluster.map((entry) => entry.startSlot));
      const clusterFinish = Math.max(...cluster.map((entry) => entry.endSlot));

      if (cluster.length === 1) {
        const entry = cluster[0];
        mergedEntries.push({
          key: entry.key,
          type: 'single',
          classItem: entry.classItem,
          title: stripClassPrefix(entry.classItem.className || '이름 없는 수업'),
          header: (
            <Badge
              size="small"
              type={text(entry.classItem.subject) === '수학' ? 'blue' : text(entry.classItem.subject) === '영어' ? 'red' : 'gray'}
              badgeStyle="weak"
            >
              {text(entry.classItem.subject) || '수업'}
            </Badge>
          ),
          detailLines: [
            { label: 'time', value: entry.scheduleLabel },
            { label: 'teacher', value: text(entry.classItem.teacher) || '선생님 미정', subtle: true },
            {
              label: 'room',
              value: text(entry.classItem.classroom || entry.classItem.room) || '강의실 미정',
              subtle: true,
            },
          ],
          columnIndex: entry.columnIndex,
          startSlot: entry.startSlot,
          endSlot: entry.endSlot,
          backgroundColor: entry.tone.bg,
          borderColor: entry.tone.border,
          textColor: entry.tone.text,
        });
      } else {
        const primary = sortClassesForLanding(cluster.map((entry) => entry.classItem))[0];
        const mergedTone = getPlannerToneForClass(primary, columnIndex);

        mergedEntries.push({
          key: `merged-${columnIndex}-${clusterStart}-${clusterFinish}`,
          type: 'merged',
          classItems: cluster.map((entry) => entry.classItem),
          title: `${text(primary?.subject) || '수업'} 외 ${cluster.length - 1}개`,
          header: (
            <Badge
              size="small"
              type={text(primary?.subject) === '수학' ? 'blue' : text(primary?.subject) === '영어' ? 'red' : 'gray'}
              badgeStyle="weak"
            >
              {text(primary?.subject) || '수업'}
            </Badge>
          ),
          detailLines: [
            {
              label: 'time',
              value: `${DAY_COLUMNS[columnIndex]} ${FULL_TIME_SLOTS[clusterStart]?.split('-')[0]} - ${
                FULL_TIME_SLOTS[clusterFinish - 1]?.split('-')[1]
              }`,
            },
          ],
          columnIndex,
          startSlot: clusterStart,
          endSlot: clusterFinish,
          backgroundColor: mergedTone.bg,
          borderColor: mergedTone.border,
          textColor: mergedTone.text,
        });
      }

      cluster = [];
      clusterEnd = -1;
    };

    dayEntries.forEach((entry) => {
      if (cluster.length === 0) {
        cluster = [entry];
        clusterEnd = entry.endSlot;
        return;
      }

      if (entry.startSlot < clusterEnd) {
        cluster.push(entry);
        clusterEnd = Math.max(clusterEnd, entry.endSlot);
        return;
      }

      flushCluster();
      cluster = [entry];
      clusterEnd = entry.endSlot;
    });

    flushCluster();
  });

  const minSlot = Math.max(0, Math.min(...mergedEntries.map((entry) => entry.startSlot)) - 1);
  const maxSlot = Math.min(FULL_TIME_SLOTS.length, Math.max(...mergedEntries.map((entry) => entry.endSlot)) + 1);

  return {
    timeSlots: FULL_TIME_SLOTS.slice(minSlot, maxSlot),
    blocks: mergedEntries.map((entry) => ({
      ...entry,
      startSlot: entry.startSlot - minSlot,
      endSlot: entry.endSlot - minSlot,
    })),
  };
}

function isSameGrade(classItem, grade) {
  return normalizeGradeToken(classItem?.grade) === normalizeGradeToken(grade);
}

function hasScheduleConflict(leftClass, rightClass) {
  const leftSlots = parseSchedule(leftClass?.schedule, leftClass) || [];
  const rightSlots = parseSchedule(rightClass?.schedule, rightClass) || [];

  return leftSlots.some((leftSlot) => {
    const leftStart = timeToMinutes(leftSlot.start);
    const leftEnd = timeToMinutes(leftSlot.end);

    return rightSlots.some((rightSlot) => {
      if (leftSlot.day !== rightSlot.day) {
        return false;
      }

      const rightStart = timeToMinutes(rightSlot.start);
      const rightEnd = timeToMinutes(rightSlot.end);
      return leftStart < rightEnd && rightStart < leftEnd;
    });
  });
}

function buildPlannerConflictMessage(candidate, conflict) {
  const candidateTitle = stripClassPrefix(candidate?.className || candidate?.name || '선택한 수업');
  const conflictTitle = stripClassPrefix(conflict?.className || conflict?.name || '기존 수업');
  const conflictLine = buildScheduleLines(conflict)[0] || '시간 미정';
  return `${candidateTitle} 수업은 ${conflictTitle} (${conflictLine})과 시간이 겹쳐 담을 수 없어요.`;
}

function resolveInitialPublicTab(tabId) {
  const normalized = text(tabId);
  return PUBLIC_BOTTOM_NAV_IDS.has(normalized) ? normalized : 'classes';
}

function buildPlannerMetaText(classItem) {
  const teacher = text(classItem?.teacher) || '선생님 미정';
  const classroom = text(classItem?.classroom || classItem?.room) || '강의실 미정';
  return `${teacher} · ${classroom}`;
}

function FilledNavIcon({ name, size = 22 }) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': 'true',
    className: 'public-filled-nav-icon',
  };

  switch (name) {
    case 'home':
      return (
        <svg {...commonProps}>
          <path d="M12 3.4 4 9.84v8.41C4 19.77 5.23 21 6.75 21h3.1c.41 0 .75-.34.75-.75v-4.1c0-.41.34-.75.75-.75h1.3c.41 0 .75.34.75.75v4.1c0 .41.34.75.75.75h3.1C18.77 21 20 19.77 20 18.25V9.84L12 3.4Z" />
        </svg>
      );
    case 'reviews':
      return (
        <svg {...commonProps}>
          <path d="m12 3.1 2.73 5.53 6.1.89-4.41 4.3 1.04 6.07L12 17.04 6.54 19.9l1.04-6.07-4.41-4.3 6.1-.89L12 3.1Z" />
        </svg>
      );
    case 'classes':
      return (
        <svg {...commonProps}>
          <path d="M5 4.2A2.8 2.8 0 0 0 2.2 7v10.3c0 .83.67 1.5 1.5 1.5h1.45c.96 0 1.9.25 2.72.72l2.38 1.36a.5.5 0 0 0 .75-.43V7A2.8 2.8 0 0 0 8.2 4.2H5Z" />
          <path d="M19 4.2A2.8 2.8 0 0 1 21.8 7v10.3c0 .83-.67 1.5-1.5 1.5h-1.45c-.96 0-1.9.25-2.72.72l-2.38 1.36a.5.5 0 0 1-.75-.43V7a2.8 2.8 0 0 1 2.8-2.8H19Z" />
        </svg>
      );
    case 'scores':
      return (
        <svg {...commonProps}>
          <path d="M6 3.5c-1.1 0-2 .9-2 2v2.2c0 2.55 1.77 4.77 4.25 5.33.46 1.22 1.32 2.24 2.45 2.86V18H8.9c-.77 0-1.4.63-1.4 1.4 0 .39.31.7.7.7h7.6c.39 0 .7-.31.7-.7 0-.77-.63-1.4-1.4-1.4H13.3v-2.11c1.13-.62 1.99-1.64 2.45-2.86C18.23 12.47 20 10.25 20 7.7V5.5c0-1.1-.9-2-2-2H6Zm0 2h-.6v2.2c0 1.22.62 2.3 1.57 2.94A6.31 6.31 0 0 1 6 7.7V5.5Zm12 0h-.6v2.2c0 1.06-.37 2.04-.97 2.84.95-.64 1.57-1.72 1.57-2.94V5.5Z" />
        </svg>
      );
    case 'inquiry':
      return (
        <svg {...commonProps}>
          <path d="M12 3.4c-4.75 0-8.6 3.42-8.6 7.65 0 2.31 1.16 4.38 2.99 5.79l-.75 3.01c-.12.48.32.88.78.71l3.57-1.31c.7.17 1.43.25 2.2.25 4.75 0 8.61-3.42 8.61-7.65S16.75 3.4 12 3.4Z" />
        </svg>
      );
    default:
      return null;
  }
}

function PublicEmbeddedPanel({ label, src, tabId }) {
  return (
    <section className="public-embedded-panel" data-testid="public-embedded-panel">
      <iframe
        key={tabId}
        title={`${label} 화면`}
        src={src}
        allow="autoplay"
        className="public-embedded-frame"
        data-testid={`public-embedded-frame-${tabId}`}
      />
    </section>
  );
}

export function PublicLandingCard({
  classItem,
  rank,
  isSelected = false,
  onOpenDetails,
  onTogglePlanner,
  hideActions = false,
  semanticButton = true,
  plannerActionLabel = '담기',
  plannerSelectedActionLabel = '빼기',
}) {
  const title = stripClassPrefix(classItem.className || classItem.name || '이름 없는 수업');
  const scheduleLines = buildScheduleLines(classItem);
  const scheduleLabel = scheduleLines.join(' · ');
  const teachers = splitLines(classItem.teacher, 5);
  const classrooms = splitLines(classItem.classroom || classItem.room, 5);
  const teacherClassroomRows = Array.from(
    { length: Math.max(teachers.length, classrooms.length, 1) },
    (_, index) => ({
      teacher: teachers[index] || (!teachers.length && index === 0 ? '선생님 미정' : ''),
      classroom: classrooms[index] || (!classrooms.length && index === 0 ? '강의실 미정' : ''),
    }),
  ).filter((row) => row.teacher || row.classroom);
  const feeText = formatCurrency(getDisplayFee(classItem));
  const enrollmentSummary = getEnrollmentSummary(classItem);
  const statusMeta = getStatusMeta(classItem);
  const subject = text(classItem.subject) || '과목';
  const grade = normalizeGrade(classItem.grade);
  const cardTone = getToneForClass(classItem, rank || 0);

  return (
    <article
      className={[
        'public-landing-card',
        rank !== undefined ? 'has-rank' : '',
        rank === 1 ? 'is-featured' : '',
        isSelected ? 'is-selected' : '',
        onOpenDetails || onTogglePlanner ? 'is-interactive' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={'public-class-card-' + (classItem?.id || 'unknown')}
      style={{
        '--public-card-accent-bg': cardTone.bg,
        '--public-card-accent-border': cardTone.border,
        '--public-card-accent-text': cardTone.text,
      }}
    >
      {rank !== undefined ? <div className='public-landing-card-rank'>{rank}</div> : null}

      <div className='public-landing-card-surface'>
        <div
          role={onOpenDetails && semanticButton ? 'button' : undefined}
          tabIndex={onOpenDetails && semanticButton ? 0 : undefined}
          aria-label={onOpenDetails && semanticButton ? title + ' 상세 보기' : undefined}
          className={['public-landing-card-main', !onOpenDetails ? 'is-static' : ''].filter(Boolean).join(' ')}
          onClick={onOpenDetails ? () => onOpenDetails(classItem) : undefined}
          onKeyDown={
            onOpenDetails
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenDetails(classItem);
                  }
                }
              : undefined
          }
        >
          <div className='public-landing-card-heading'>
            <div className='public-landing-card-eyebrow-row'>
              <Badge 
                size='small' 
                type={text(subject) === '수학' ? 'blue' : text(subject) === '영어' ? 'red' : 'gray'}
                badgeStyle='weak'
              >
                {subject}
              </Badge>
              <span className='public-landing-card-grade-label'>{grade}</span>
            </div>
            <h3 className='public-landing-card-title'>{title}</h3>
          </div>

          <div className='public-landing-card-meta-list'>
            <div className='public-landing-card-meta-item public-landing-card-meta-item-schedule'>
              <div className='public-landing-card-meta-icon'>
                <CalendarDays size={14} />
              </div>
              <span>{scheduleLabel}</span>
            </div>

            <div className='public-landing-card-meta-grid'>
              {teacherClassroomRows.flatMap((row, index) => [
                <div className='public-landing-card-meta-item' key={'teacher-' + index}>
                  <div className='public-landing-card-meta-icon'>
                    <UserRound size={14} />
                  </div>
                  <span>{row.teacher || '\u00A0'}</span>
                </div>,
                <div className='public-landing-card-meta-item' key={'room-' + index}>
                  <div className='public-landing-card-meta-icon'>
                    <MapPin size={14} />
                  </div>
                  <span>{row.classroom || '\u00A0'}</span>
                </div>,
              ])}

              <div className='public-landing-card-meta-item public-landing-card-meta-item-price'>
                <div className='public-landing-card-meta-icon'>
                  <Banknote size={14} />
                </div>
                <span>{feeText}</span>
              </div>

              <div className='public-landing-card-meta-item public-landing-card-meta-item-capacity'>
                <div className='public-landing-card-meta-icon'>
                  <Users size={14} />
                </div>
                <span>{enrollmentSummary}</span>
              </div>
            </div>
          </div>
        </div>

        <div className='public-landing-card-status-anchor'>
          <Badge
            size='medium'
            type={statusMeta.badgeType}
            badgeStyle='fill'
            className={[
              'public-landing-status-badge',
              statusMeta.detail ? 'is-animated' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {statusMeta.detail ? (
              <>
                <strong>{statusMeta.label}</strong>
                <span>{statusMeta.detail}</span>
              </>
            ) : (
              statusMeta.label
            )}
          </Badge>
        </div>

        {!hideActions && onTogglePlanner ? (
          <div className='public-landing-card-footer'>
            <Button
              type='primary'
              style={isSelected ? 'weak' : 'fill'}
              size='medium'
              className='public-landing-card-cart-button'
              data-testid={'public-card-toggle-' + classItem?.id}
              onPress={(event) => {
                event?.stopPropagation?.();
                onTogglePlanner(classItem);
              }}
            >
              {isSelected ? plannerSelectedActionLabel : plannerActionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function PublicClassLandingView({
  classes,
  textbooks = [],
  progressLogs = [],
  isLoading = false,
  initialPublicTab = 'classes',
  onLogin,
  showBackToDashboard = false,
  onBackToDashboard,
  theme = '',
  onToggleTheme = () => {},
}) {
  const { isMobile, isCompact } = useViewport();
  const toast = useToast();
  const safeTheme =
    theme ||
    (typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme') || 'light'
      : 'light');

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activePublicTab, setActivePublicTab] = useState(() =>
    resolveInitialPublicTab(initialPublicTab),
  );
  const [selectedSubject, setSelectedSubject] = useState(DEFAULT_SUBJECT);
  const [selectedGrade, setSelectedGrade] = useState(DEFAULT_GRADE);
  const [plannerItems, setPlannerItems] = useState([]);
  const [plannerGrade, setPlannerGrade] = useState('');
  const [isPlannerSheetOpen, setIsPlannerSheetOpen] = useState(false);
  const [selectedClassItem, setSelectedClassItem] = useState(null);
  const [isSharingPlanner, setIsSharingPlanner] = useState(false);

  const cardListRef = useRef(null);
  const plannerPreviewRef = useRef(null);
  const plannerCaptureRef = useRef(null);
  const gradeTabRowRef = useRef(null);
  const autoClearedSubjectRef = useRef(false);
  const autoClearedGradeRef = useRef(false);

  const activeClasses = useMemo(
    () => (classes || []).filter((item) => computeClassStatus(item) === ACTIVE_CLASS_STATUS),
    [classes],
  );

  const availableSubjects = useMemo(
    () =>
      PUBLIC_SUBJECT_TABS.filter((subject) =>
        activeClasses.some((item) => text(item.subject) === subject),
      ),
    [activeClasses],
  );

  useEffect(() => {
    if (!availableSubjects.length) {
      autoClearedSubjectRef.current = true;
      setSelectedSubject('');
      return;
    }

    if (!selectedSubject && autoClearedSubjectRef.current) {
      autoClearedSubjectRef.current = false;
      setSelectedSubject(
        availableSubjects.includes(DEFAULT_SUBJECT) ? DEFAULT_SUBJECT : availableSubjects[0],
      );
      return;
    }

    if (selectedSubject && !availableSubjects.includes(selectedSubject)) {
      setSelectedSubject(
        availableSubjects.includes(DEFAULT_SUBJECT) ? DEFAULT_SUBJECT : availableSubjects[0],
      );
    }
  }, [availableSubjects, selectedSubject]);

  const subjectSearchFilteredClasses = useMemo(() => {
    const query = text(deferredSearchQuery).toLowerCase();
    return activeClasses.filter((item) => {
      const matchesSubject = !selectedSubject || text(item.subject) === selectedSubject;
      const haystack = [
        stripClassPrefix(item.className || item.name),
        item.subject,
        item.grade,
        item.teacher,
        item.classroom,
        item.room,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return matchesSubject && (!query || haystack.includes(query));
    });
  }, [activeClasses, deferredSearchQuery, selectedSubject]);

  const gradeCounts = useMemo(
    () =>
      Object.fromEntries(
        PUBLIC_GRADE_TABS.map((grade) => [
          grade,
          subjectSearchFilteredClasses.filter((item) => isSameGrade(item, grade)).length,
        ]),
      ),
    [subjectSearchFilteredClasses],
  );

  const availableGrades = useMemo(
    () => PUBLIC_GRADE_TABS.filter((grade) => gradeCounts[grade] > 0),
    [gradeCounts],
  );

  useEffect(() => {
    if (!availableGrades.length) {
      autoClearedGradeRef.current = true;
      setSelectedGrade('');
      return;
    }

    if (!selectedGrade && autoClearedGradeRef.current) {
      autoClearedGradeRef.current = false;
      setSelectedGrade(availableGrades.includes(DEFAULT_GRADE) ? DEFAULT_GRADE : availableGrades[0]);
      return;
    }

    if (selectedGrade && !availableGrades.includes(selectedGrade)) {
      setSelectedGrade(availableGrades.includes(DEFAULT_GRADE) ? DEFAULT_GRADE : availableGrades[0]);
    }
  }, [availableGrades, selectedGrade]);

  const filteredClasses = useMemo(
    () =>
      sortClassesForLanding(
        subjectSearchFilteredClasses.filter((item) => !selectedGrade || isSameGrade(item, selectedGrade)),
      ),
    [selectedGrade, subjectSearchFilteredClasses],
  );

  const plannerSelectedIds = useMemo(
    () => new Set(plannerItems.map((item) => item.id)),
    [plannerItems],
  );

  const plannerTimetable = useMemo(() => buildTimetableData(plannerItems), [plannerItems]);
  const plannerSummaryText = useMemo(() => buildPlannerSummaryText(plannerItems), [plannerItems]);

  const plannerHeadlineText = plannerItems.length
    ? `내 시간표 ${plannerSummaryText || ''}`.trim()
    : '내 시간표';

  const plannerSubtitleText = plannerItems.length
    ? `${plannerGrade || selectedGrade || '선택 학년'} 수업 시간표 · 이미지 공유 가능`
    : '원하는 수업만 담아 나만의 수업 시간표를 바로 만들어보세요.';

  const plannerPreviewTitleText = plannerItems.length
    ? `${plannerGrade || selectedGrade || '선택 학년'} 수업 시간표`
    : '내 수업 시간표';

  const plannerShareText = plannerItems.length
    ? `${plannerGrade || selectedGrade || '선택 학년'} · ${plannerSummaryText || '선택 수업'}`
    : '선택한 수업이 아직 없어요.';

  const selectedClassBadges = useMemo(() => {
    if (!selectedClassItem) {
      return [];
    }

    const badges = buildModalSummaryBadges(selectedClassItem, {
      grade: normalizeGrade(selectedClassItem.grade),
      subject: selectedClassItem.subject,
    });

    if (plannerSelectedIds.has(selectedClassItem.id)) {
      badges.unshift({ label: '내 시간표에 담김', tone: 'accent' });
    }

    return badges.slice(0, 4);
  }, [plannerSelectedIds, selectedClassItem]);

  useEffect(() => {
    if (plannerItems.length === 0) {
      setPlannerGrade('');
    }
  }, [plannerItems.length]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleEmbeddedNavigation = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data;
      if (!data || data.type !== 'tips-public-nav') {
        return;
      }

      const requestedTab = data.tab;
      if (requestedTab !== 'classes' && !EMBEDDED_PUBLIC_VIEW_URLS[requestedTab]) {
        return;
      }

      setActivePublicTab(requestedTab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.addEventListener('message', handleEmbeddedNavigation);
    return () => window.removeEventListener('message', handleEmbeddedNavigation);
  }, []);

  const subjectTabItems = useMemo(
    () =>
      PUBLIC_SUBJECT_TABS.map((subject) => ({
        value: subject,
        label: subject,
        disabled: !availableSubjects.includes(subject),
        testId: `public-subject-tab-${subject}`,
        className: 'public-landing-chip-tab',
      })),
    [availableSubjects],
  );

  const gradeTabItems = useMemo(
    () =>
      PUBLIC_GRADE_TABS.map((grade) => ({
        value: grade,
        label: grade,
        disabled: gradeCounts[grade] === 0,
        testId: `public-grade-tab-${grade}`,
        className: 'public-landing-pill-tab',
      })),
    [gradeCounts],
  );

  const openClassDetails = (classItem) => {
    setSelectedClassItem(classItem);
  };

  const handleOpenChannelTalk = (context = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.__tipsPublicCounselContext = {
      source: 'public-landing',
      grade: context.grade || selectedGrade || plannerGrade || '',
      subject: context.subject || selectedSubject || '',
      className: context.className || '',
    };

    const popup = window.open(
      CHANNEL_TALK_URL,
      'tips-channel-talk',
      'popup=yes,width=420,height=760,noopener,noreferrer',
    );

    if (!popup) {
      toast.info('채널톡 팝업이 차단되었어요. 브라우저에서 팝업을 허용해 주세요.');
    }
  };

  const togglePlannerItem = (classItem) => {
    const normalizedGrade = normalizeGrade(classItem.grade);
    const title = stripClassPrefix(classItem.className || classItem.name || '수업');

    if (plannerSelectedIds.has(classItem.id)) {
      setPlannerItems((current) => current.filter((item) => item.id !== classItem.id));
      toast.info(`${title} 수업을 내 시간표에서 뺐습니다.`);
      return;
    }

    if (plannerGrade && plannerGrade !== normalizedGrade) {
      toast.info(
        `현재 내 시간표는 ${plannerGrade} 기준입니다. 전체 비우기 후 다른 학년을 담아주세요.`,
      );
      return;
    }

    const conflict = plannerItems.find((item) => hasScheduleConflict(item, classItem));
    if (conflict) {
      toast.error(buildPlannerConflictMessage(classItem, conflict));
      return;
    }

    setPlannerItems((current) => [...current, classItem]);
    setPlannerGrade((current) => current || normalizedGrade);
    toast.success('내 시간표에 수업을 담았어요.', {
      duration: 3800,
      actionLabel: '보러가기',
      onAction: () => setIsPlannerSheetOpen(true),
    });
  };

  const clearPlanner = () => {
    setPlannerItems([]);
    setPlannerGrade('');
    setIsPlannerSheetOpen(false);
    toast.info('내 시간표를 비웠습니다.');
  };

  const openPlannerSheet = () => {
    if (!plannerItems.length) {
      toast.info('먼저 수업을 내 시간표에 담아주세요.');
      return;
    }
    setIsPlannerSheetOpen(true);
  };

  const handleSharePlanner = async () => {
    if (!plannerCaptureRef.current || !plannerItems.length) {
      return;
    }

    setIsSharingPlanner(true);

    const el = plannerCaptureRef.current;
    const savedWidth = el.style.width;

    try {
      /* Temporarily expand only during capture so the live sheet keeps its mobile width. */
      el.setAttribute('data-capturing', 'true');
      el.style.width = 'max-content';
      const naturalWidth = Math.max(el.scrollWidth, 900) + 80; /* 80 = 2 × padding */
      el.style.width = savedWidth;

      const blob = await captureElementAsPngBlob(el, {
        width: naturalWidth,
        padding: 40,
        scale: 3,
      });

      if (!blob) {
        throw new Error('planner share blob missing');
      }

      const filename = `TIPS-${plannerGrade || 'public'}-수업-시간표.png`;

      if (typeof navigator !== 'undefined' && typeof File !== 'undefined' && navigator.share) {
        const file = new File([blob], filename, { type: 'image/png' });

        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'TIPS 수업 시간표',
            text: plannerShareText,
            files: [file],
          });
          toast.success('시간표 공유 화면을 열었습니다.');
          return;
        }
      }

      downloadBlob(blob, filename);
      toast.info('공유를 지원하지 않아 이미지 다운로드로 대신했습니다.');
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      console.error(error);
      toast.error('시간표 이미지를 만드는 중 문제가 생겼습니다.');
    } finally {
      el.style.width = savedWidth;
      el.removeAttribute('data-capturing');
      setIsSharingPlanner(false);
    }
  };

  const scrollToCards = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (cardListRef.current) {
      cardListRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectSubject = (subject) => {
    autoClearedSubjectRef.current = false;
    setSelectedSubject((current) => (current === subject ? '' : subject));
    scrollToCards();
  };

  const handleSelectGrade = (grade) => {
    autoClearedGradeRef.current = false;
    setSelectedGrade((current) => (current === grade ? '' : grade));
    scrollToCards();
  };

  const handleBottomNavClick = (item) => {
    if (item.id === 'inquiry') {
      handleOpenChannelTalk({ grade: selectedGrade, subject: selectedSubject });
      return;
    }

    setActivePublicTab(item.id);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAccountAction = () => {
    setActivePublicTab('classes');

    if (showBackToDashboard && typeof onBackToDashboard === 'function') {
      onBackToDashboard();
      return;
    }

    if (typeof onLogin === 'function') {
      onLogin();
    }
  };

  const plannerActions = (
    <div className="public-planner-sheet-footer-actions">
      <Button
        type="primary"
        style="fill"
        size="medium"
        onPress={clearPlanner}
        disabled={!plannerItems.length}
        leftAccessory={<Trash2 size={16} />}
      >
        전체 비우기
      </Button>
      <Button
        type="danger"
        style="fill"
        size="medium"
        onPress={handleSharePlanner}
        disabled={!plannerItems.length || isSharingPlanner}
        leftAccessory={<Share2 size={16} />}
      >
        {isSharingPlanner ? '이미지 준비 중' : '이미지 공유'}
      </Button>
    </div>
  );

  const selectedClassIsInPlanner = selectedClassItem
    ? plannerSelectedIds.has(selectedClassItem.id)
    : false;
  const isEmbeddedPublicTab = Boolean(EMBEDDED_PUBLIC_VIEW_URLS[activePublicTab]);
  const activeEmbeddedItem = isEmbeddedPublicTab
    ? PUBLIC_BOTTOM_NAV_ITEMS.find((item) => item.id === activePublicTab) || null
    : null;

  return (
    <div
      data-testid="public-class-list-view"
      className={`public-landing-shell ${isMobile ? 'is-mobile' : 'is-desktop'} ${safeTheme === 'dark' ? 'is-dark' : 'is-light'} ${isEmbeddedPublicTab ? 'has-embedded-view' : ''}`}
    >
      {!isEmbeddedPublicTab ? (
      <header className={`public-landing-topbar ${isMobile ? 'is-mobile' : 'is-desktop'}`} data-testid="public-mobile-topbar">
        <div className="public-landing-search-row">
          <SearchField
            value={searchQuery}
            onChange={({ nativeEvent }) => setSearchQuery(nativeEvent.text)}
            hasClearButton
            className="public-landing-search-field"
            data-testid="public-class-search-input"
            placeholder="수업명, 선생님, 강의실"
          />

          <IconButton
            variant="border"
            className="public-topbar-icon-button public-topbar-action-button"
            label="테마 전환"
            onPress={onToggleTheme}
            icon={
              safeTheme === 'dark' ? (
                <Sun size={19} strokeWidth={2.1} />
              ) : (
                <Moon size={19} strokeWidth={2.1} />
              )
            }
          />

          <IconButton
            variant="border"
            className="public-topbar-icon-button public-topbar-logo-button"
            label={showBackToDashboard ? '대시보드로 돌아가기' : '팁스 로고'}
            data-testid="public-logo-button"
            onPress={handleAccountAction}
            icon={
              <img src="/logo_tips.png" alt="" aria-hidden="true" />
            }
          />
        </div>

        {activePublicTab === 'classes' ? (
          <>
            <Tab
              size="large"
              value={selectedSubject}
              onChange={handleSelectSubject}
              items={subjectTabItems}
              className="public-landing-tab-row public-landing-tab-row-subject public-landing-subject-tab"
              data-testid="public-subject-tabs"
            />

            <Tab
              size="small"
              fluid
              value={selectedGrade}
              onChange={handleSelectGrade}
              items={gradeTabItems}
              className="public-landing-tab-row public-landing-tab-row-grade public-landing-grade-tab"
              data-testid="public-grade-tabs"
              scrollerRef={gradeTabRowRef}
            />
          </>
        ) : null}
      </header>
      ) : null}

      <main className={`public-landing-main ${isCompact ? 'is-compact' : ''} ${isEmbeddedPublicTab ? 'has-embedded-view' : ''}`}>
        {isEmbeddedPublicTab ? (
          <PublicEmbeddedPanel
            tabId={activePublicTab}
            label={activeEmbeddedItem?.label || '공개'}
            src={EMBEDDED_PUBLIC_VIEW_URLS[activePublicTab]}
          />
        ) : (
          <>
            <section className="public-landing-section-head">
              <div className="public-landing-section-copy">
                <div className="public-landing-section-kicker">
                  {buildSectionKicker(selectedSubject, selectedGrade)}
                </div>
                <h1 className="public-landing-section-title">
                  {buildSectionTitle(selectedSubject, selectedGrade)}
                </h1>
                <p className="public-landing-section-description">
                  원하는 수업만 담아서 나만의 수업 시간표를 바로 만들어보세요.
                </p>
              </div>
            </section>

            {isLoading ? (
              <PublicClassLandingSkeleton isMobile={isMobile} />
            ) : filteredClasses.length === 0 ? (
              <section className="public-empty-state" data-testid="public-empty-state">
                조건에 맞는 수업이 없습니다.
              </section>
            ) : (
              <div className={`public-landing-content-grid ${!isMobile ? 'is-desktop' : ''}`}>
                <section ref={cardListRef} className="public-landing-card-list" data-testid="public-card-list">
                  {filteredClasses.map((classItem, index) => (
                    <PublicLandingCard
                      key={classItem.id || `${classItem.className}-${index}`}
                      classItem={classItem}
                      rank={index + 1}
                      isSelected={plannerSelectedIds.has(classItem.id)}
                      onOpenDetails={openClassDetails}
                      onTogglePlanner={togglePlannerItem}
                    />
                  ))}
                </section>

                {!isMobile ? (
                  <aside className="public-desktop-planner-panel">
                    <div className="public-desktop-planner-panel-head">
                      <strong>{plannerHeadlineText}</strong>
                      <p>{plannerSubtitleText}</p>
                    </div>
                    <Button
                      type="primary"
                      style="fill"
                      size="medium"
                      className="public-planner-open-button btn btn-primary"
                      onPress={openPlannerSheet}
                    >
                      시간표 열기
                    </Button>
                  </aside>
                ) : null}
              </div>
            )}
          </>
        )}
      </main>

      <ClassSchedulePlanModal
        open={Boolean(selectedClassItem)}
        mode="readonly"
        classItem={selectedClassItem}
        plan={selectedClassItem?.schedulePlan || selectedClassItem?.schedule_plan || null}
        textbooksCatalog={textbooks}
        progressLogs={progressLogs}
        emptyMessage="아직 등록된 일정표가 없습니다."
        onClose={() => setSelectedClassItem(null)}
        primaryActionLabel="상담하기"
        onPrimaryAction={() =>
          handleOpenChannelTalk({
            grade: normalizeGrade(selectedClassItem?.grade),
            subject: selectedClassItem?.subject,
            className: stripClassPrefix(selectedClassItem?.className || selectedClassItem?.name || '수업'),
          })
        }
        secondaryActionLabel={selectedClassIsInPlanner ? '빼기' : '담기'}
        secondaryActionStyle={selectedClassIsInPlanner ? 'weak' : 'fill'}
        onSecondaryAction={() => {
          if (selectedClassItem) {
            togglePlannerItem(selectedClassItem);
          }
        }}
        summaryBadges={selectedClassBadges}
      />

      <BottomSheet
        open={isPlannerSheetOpen}
        onClose={() => setIsPlannerSheetOpen(false)}
        title="내 시간표"
        subtitle={plannerSubtitleText}
        testId="public-planner-sheet"
        fullHeightOnMobile
        showHandleOnMobile={false}
        maxWidth={isMobile ? 1320 : 1080}
        actions={plannerActions}
      >
        <div className="public-planner-sheet-body">
          <div ref={plannerPreviewRef} className="public-planner-preview-card">
            <div className="public-planner-sticky-top" data-testid="public-planner-sticky-top">
              <div className="public-planner-selected-list">
                {plannerItems.map((item) => (
                  <div key={`planner-item-${item.id}`} className="public-planner-selected-item">
                    <div className="public-planner-selected-copy">
                      <div className="public-planner-selected-title-line">
                        <Badge
                          size="small"
                          type={text(item.subject) === '수학' ? 'blue' : text(item.subject) === '영어' ? 'red' : 'gray'}
                          badgeStyle="weak"
                        >
                          {text(item.subject) || '과목'}
                        </Badge>
                        <strong>{stripClassPrefix(item.className || item.name || '수업')}</strong>
                      </div>
                      <div className="public-planner-selected-info-row">
                        <CalendarDays size={14} strokeWidth={2.1} aria-hidden="true" />
                        <span>{buildScheduleLines(item).join(' · ')}</span>
                      </div>
                      <div className="public-planner-selected-info-row">
                        <UserRound size={14} strokeWidth={2.1} aria-hidden="true" />
                        <span>{buildPlannerFieldText(item.teacher, '선생님 미정')}</span>
                      </div>
                      <div className="public-planner-selected-info-row">
                        <MapPin size={14} strokeWidth={2.1} aria-hidden="true" />
                        <span>{buildPlannerFieldText(item.classroom || item.room, '강의실 미정')}</span>
                      </div>
                      <span
                        className="public-planner-selected-meta"
                        data-testid="public-planner-selected-meta"
                      >
                        {buildPlannerMetaText(item)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="public-planner-selected-remove"
                      onClick={() => togglePlannerItem(item)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div ref={plannerCaptureRef} className="public-planner-capture-wrapper">
                <div className="public-planner-preview-head">
                  <span className="public-planner-preview-eyebrow">TIPS MY TIMETABLE</span>
                  <strong>{plannerPreviewTitleText}</strong>
                </div>

                <div className="public-planner-preview-chip-row">
                  {plannerItems.map((item) => (
                    <span key={`planner-chip-${item.id}`} className="public-planner-preview-chip">
                      <span className="public-planner-preview-chip-title">
                        <Badge
                          size="small"
                          type={text(item.subject) === '수학' ? 'blue' : text(item.subject) === '영어' ? 'red' : 'gray'}
                          badgeStyle="weak"
                        >
                          {text(item.subject)}
                        </Badge>
                        <span className="public-planner-preview-chip-sep"> · </span>
                        {stripClassPrefix(item.className || item.name || '수업')}
                      </span>
                      <span className="public-planner-preview-chip-schedule">
                        {buildScheduleLines(item).join(', ')}
                      </span>
                      <span
                        className="public-planner-preview-chip-meta"
                        data-testid="public-planner-preview-chip-meta"
                      >
                        {buildPlannerMetaText(item)}
                      </span>
                    </span>
                  ))}
                </div>

                <div className="public-planner-preview-grid">
                  <TimetableGrid
                    columns={DAY_COLUMNS}
                    timeSlots={plannerTimetable.timeSlots}
                    blocks={plannerTimetable.blocks}
                    editable={false}
                    density="micro"
                    slotHeight={42}
                    timeColumnWidth={isMobile ? 84 : 72}
                    minColumnWidth={isMobile ? 90 : 94}
                    shellClassName="public-readonly-timetable public-planner-readonly-timetable"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </BottomSheet>

      {isMobile && activePublicTab === 'classes' && plannerItems.length > 0 ? (
        <div className="public-planner-floating-shell">
          <button
            type="button"
            className="public-planner-floating-clear"
            data-testid="public-planner-clear"
            onClick={clearPlanner}
            aria-label="전체 비우기"
            title="전체 비우기"
          >
            <Trash2 size={17} />
          </button>

          <button
            type="button"
            className="public-planner-floating-cta"
            data-testid="public-planner-cta"
            onClick={openPlannerSheet}
          >
            <CalendarDays size={18} />
            <div className="public-planner-floating-copy">
              <strong>{plannerHeadlineText}</strong>
              <span>{plannerSubtitleText}</span>
            </div>
            <ChevronRight size={18} />
          </button>
        </div>
      ) : null}

      <nav className="public-bottom-nav" data-testid="public-bottom-nav">
        {PUBLIC_BOTTOM_NAV_ITEMS.map((item) => {
          const isActive = activePublicTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              className={`public-bottom-nav-button ${isActive ? 'is-active' : ''}`}
              data-testid={`public-bottom-nav-${item.id}`}
              onClick={() => handleBottomNavClick(item)}
            >
              <FilledNavIcon name={item.id} size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
