import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar as CalendarIcon,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { dataService as sharedDataService } from '../services/dataService';
import { useToast } from '../contexts/ToastContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import ConfirmDialog from './ui/ConfirmDialog';
import BottomSheet from './ui/BottomSheet';
import StatusBanner from './ui/StatusBanner';
import { DashboardFilterSheet } from './ui/dashboard';
import { useAuth } from '../contexts/AuthContext';
import { getAcademicCalendarWriteState, getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { detectAcademicWorkbookFormat, parseHighSchoolMatrixWorkbook } from '../lib/academicWorkbookUtils';
import {
  buildSchoolMaster,
  getGradeOptionsForSelection,
  getGradeSortValue,
  getSchoolCategoryLabel,
  inferSchoolCategoryFromGrade,
  SCHOOL_CATEGORY_FILTER_OPTIONS,
  SCHOOL_CATEGORY_OPTIONS,
} from '../lib/schoolConfig';
import useViewport from '../hooks/useViewport';
import CurriculumRoadmapView from './CurriculumRoadmapView';
import { Button, CheckboxMenu, SegmentedControl, Tab } from './ui/tds';

const EVENT_TYPE_COLOR_PALETTE = ['#2f6f63', '#2563eb', '#7c3aed', '#0f766e', '#d97706', '#b91c1c', '#64748b', '#c2410c'];
const DEFAULT_EVENT_COLOR = EVENT_TYPE_COLOR_PALETTE[0];
const VACATION_MISC_EVENT_TYPE = '방학·휴일·기타';
const DEFAULT_EVENT_TYPE_DEFINITIONS = [
  { id: 'exam-window', name: '시험기간', color: EVENT_TYPE_COLOR_PALETTE[0] },
  { id: 'english-exam-day', name: '영어시험일', color: EVENT_TYPE_COLOR_PALETTE[1] },
  { id: 'math-exam-day', name: '수학시험일', color: EVENT_TYPE_COLOR_PALETTE[2] },
  { id: 'field-trip', name: '체험학습', color: EVENT_TYPE_COLOR_PALETTE[3] },
  { id: 'vacation-misc', name: VACATION_MISC_EVENT_TYPE, color: EVENT_TYPE_COLOR_PALETTE[4] },
  { id: 'tips', name: '팁스', color: EVENT_TYPE_COLOR_PALETTE[7] },
];
const DEFAULT_EVENT_TYPES = DEFAULT_EVENT_TYPE_DEFINITIONS.map((item) => item.name);
const DEFAULT_EVENT_TYPE_IDS = Object.fromEntries(DEFAULT_EVENT_TYPE_DEFINITIONS.map((item) => [item.name, item.id]));
const SUBJECT_OPTIONS = ['영어', '수학'];
const FIXED_ROADMAP_PERIOD_OPTIONS = [
  { code: 'S1_MID', label: '1학기 중간' },
  { code: 'S1_FINAL', label: '1학기 기말' },
  { code: 'S2_MID', label: '2학기 중간' },
  { code: 'S2_FINAL', label: '2학기 기말' },
];
const ROADMAP_SUBJECT_BY_EVENT_TYPE = {
  영어시험일: '영어',
  수학시험일: '수학',
};
const ROADMAP_SCHEDULE_COLUMN_BY_EVENT_TYPE = {
  체험학습: 'field-trip',
  [VACATION_MISC_EVENT_TYPE]: 'vacation-misc',
};
const EVENT_VIEW_STORAGE_KEY = 'tips-academic-view-v3';
const NOTE_META_MARKER = '[[TIPS_META]]';
const NON_REMOVABLE_EVENT_TYPE_IDS = new Set(DEFAULT_EVENT_TYPE_DEFINITIONS.map((item) => item.id));
const ASSESSMENT_EVENT_TYPES = new Set(['시험기간', '영어시험일', '수학시험일']);
const ROADMAP_LINKABLE_EVENT_TYPES = new Set([
  '시험기간',
  '영어시험일',
  '수학시험일',
  '체험학습',
  VACATION_MISC_EVENT_TYPE,
]);
const SCHOOL_GRADE_REQUIRED_EVENT_TYPES = new Set(['시험기간', '영어시험일', '수학시험일', '체험학습', VACATION_MISC_EVENT_TYPE]);
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function text(value) {
  return String(value || '').trim();
}

function inferRoadmapPeriodCodeFromDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'S1_MID';
  if (month >= 6 && month <= 7) return 'S1_FINAL';
  if (month >= 8 && month <= 10) return 'S2_MID';
  return 'S2_FINAL';
}

function buildAcademicYearOptions(referenceYear) {
  const baseYear = Number(referenceYear) || new Date().getFullYear();
  return [baseYear - 1, baseYear, baseYear + 1, baseYear + 2];
}

function inferRoadmapPeriodCode(event) {
  const explicit = text(event?.roadmapPeriodCode || event?.meta?.roadmapPeriodCode);
  if (explicit) return explicit;
  const source = `${text(event?.title)} ${text(event?.note)}`;
  if (source.includes('1학기') && source.includes('중간')) return 'S1_MID';
  if (source.includes('1학기') && source.includes('기말')) return 'S1_FINAL';
  if (source.includes('2학기') && source.includes('중간')) return 'S2_MID';
  if (source.includes('2학기') && source.includes('기말')) return 'S2_FINAL';
  return inferRoadmapPeriodCodeFromDate(event?.start || event?.date || '');
}

function inferRoadmapSubject(event) {
  const explicit = text(event?.roadmapSubject || event?.meta?.roadmapSubject);
  if (explicit) return explicit;
  const typed = ROADMAP_SUBJECT_BY_EVENT_TYPE[normalizeType(event?.type)];
  if (typed) return typed;
  const source = `${text(event?.title)} ${text(event?.note)}`;
  return SUBJECT_OPTIONS.find((subject) => source.includes(subject)) || '';
}

function buildRoadmapIntentFromEvent(event) {
  const eventType = normalizeType(event?.type);
  return {
    tab: 'school',
    schoolId: event?.schoolId || '',
    schoolName: event?.school || '',
    schoolKey: event?.school ? schoolKey(event.school) : '',
    schoolCategory:
      text(event?.category) ||
      (text(event?.grade) && text(event?.grade) !== 'all' ? inferSchoolCategoryFromGrade(text(event?.grade)) : ''),
    grade: text(event?.grade) === 'all' ? '' : text(event?.grade),
    subject: text(event?.roadmapSubject) || inferRoadmapSubject(event),
    periodCode: text(event?.periodCode || event?.roadmapPeriodCode) || inferRoadmapPeriodCode(event),
    academicYear: Number(event?.academicYear || event?.meta?.academicYear || String(event?.start || '').slice(0, 4) || 0) || '',
    focusTarget: ASSESSMENT_EVENT_TYPES.has(eventType) ? 'grade-cell' : 'schedule-column',
    scheduleColumnKey: ROADMAP_SCHEDULE_COLUMN_BY_EVENT_TYPE[eventType] || '',
    eventType,
    eventId: text(event?.id),
    date: text(event?.start || event?.date),
  };
}

function pickEventTypeColor(name = '', index = 0) {
  const seed = `${String(name || '').trim()}-${index}`;
  let hash = 0;
  for (let cursor = 0; cursor < seed.length; cursor += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(cursor);
    hash |= 0;
  }
  const paletteIndex = Math.abs(hash || index) % EVENT_TYPE_COLOR_PALETTE.length;
  return EVENT_TYPE_COLOR_PALETTE[paletteIndex];
}

function schoolKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function normalizeEventTypeDefinitions(raw) {
  const source = Array.isArray(raw) && raw.length > 0
    ? [
        ...DEFAULT_EVENT_TYPE_DEFINITIONS,
        ...raw.filter((entry) => {
          const entryId = text(entry?.id);
          const entryName = typeof entry === 'string' ? text(entry) : text(entry?.name);
          const normalizedEntryName = normalizeType(entryName);
          return !DEFAULT_EVENT_TYPE_DEFINITIONS.some((item) => item.id === entryId || item.name === normalizedEntryName);
        }),
      ]
    : DEFAULT_EVENT_TYPE_DEFINITIONS;
  return source
    .map((entry, index) => {
      const normalizedName = normalizeType(typeof entry === 'string' ? entry : entry?.name);
      const defaultEntry = DEFAULT_EVENT_TYPE_DEFINITIONS.find((item) =>
        item.name === normalizedName || item.id === text(entry?.id)
      );
      if (typeof entry === 'string') {
        return {
          id: defaultEntry?.id || `${entry}-${index}`,
          name: normalizedName,
          color: defaultEntry?.color || pickEventTypeColor(entry, index),
        };
      }
      return {
        id: text(entry.id) || `${text(entry.name) || 'type'}-${index}`,
        name: normalizedName,
        color: text(entry.color) || defaultEntry?.color || pickEventTypeColor(entry.name, index),
      };
    })
    .filter((entry) => entry.name);
}

function stripNoteMeta(note) {
  const raw = String(note || '');
  const markerIndex = raw.indexOf(NOTE_META_MARKER);
  if (markerIndex < 0) {
    return { noteText: raw, meta: {} };
  }

  const noteText = raw.slice(0, markerIndex).trimEnd();
  const encoded = raw.slice(markerIndex + NOTE_META_MARKER.length).trim();
  try {
    return { noteText, meta: JSON.parse(encoded) };
  } catch {
    return { noteText: raw, meta: {} };
  }
}

function mergeNoteMeta(noteText, meta = {}) {
  const cleanNote = String(noteText || '').trim();
  const cleanMeta = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
  );

  if (Object.keys(cleanMeta).length === 0) {
    return cleanNote;
  }

  return `${cleanNote}${cleanNote ? '\n\n' : ''}${NOTE_META_MARKER}${JSON.stringify(cleanMeta)}`;
}

function normalizeTags(tags = []) {
  return [...new Set((tags || []).map((tag) => text(tag)).filter(Boolean))];
}

function splitGradeTokens(value = '') {
  const raw = text(value);
  if (!raw || raw === 'all') return [];
  return [...new Set(raw.split(/[,\n/]+/).map((item) => text(item)).filter(Boolean))];
}

function joinGradeTokens(values = []) {
  const normalized = [...new Set((values || []).map((item) => text(item)).filter(Boolean))];
  return normalized.length ? normalized.join(', ') : '';
}

function getEventGradeTokens(event) {
  if (Array.isArray(event.grades) && event.grades.length > 0) {
    return event.grades;
  }
  return splitGradeTokens(event.grade);
}

function formatEventMetaTokens(event) {
  const tokens = [];
  if (text(event.school)) {
    tokens.push({ key: `school-${event.school}`, label: event.school, tone: 'school' });
  }
  getEventGradeTokens(event).forEach((grade) => {
    tokens.push({ key: `grade-${grade}`, label: grade, tone: 'grade' });
  });
  return tokens;
}

function formatEventMetaSummary(event, options = {}) {
  const { includeType = true } = options;
  const parts = [];
  if (text(event.school)) parts.push(event.school);
  const grades = getEventGradeTokens(event);
  if (grades.length > 0) parts.push(grades.join(', '));
  if (includeType && text(event.type)) parts.push(event.type);
  return parts.join(' · ') || '공통 일정';
}

function getCondensedEventMetaTokens(event) {
  const tokens = [];
  if (text(event.school)) {
    tokens.push({ key: `school-${event.school}`, label: event.school, tone: 'school' });
  }
  const grades = getEventGradeTokens(event);
  grades.forEach((grade) => {
    tokens.push({ key: `grade-${grade}`, label: grade, tone: 'grade' });
  });
  return tokens;
}

function hasRoadmapContext(event) {
  return Boolean(text(event?.school) && getEventGradeTokens(event).length > 0);
}

function canOpenRoadmapFromEvent(event) {
  return (
    ROADMAP_LINKABLE_EVENT_TYPES.has(normalizeType(event?.type)) &&
    hasRoadmapContext(event)
  );
}

function moveArrayItem(items = [], index, direction) {
  const next = [...items];
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }
  const [removed] = next.splice(index, 1);
  next.splice(targetIndex, 0, removed);
  return next;
}

function isSameAcademicEventRecord(left, right) {
  if (!left || !right) return false;
  return [
    text(left.id),
    text(left.title),
    text(left.schoolId || left.school_id || left.school),
    text(left.type),
    text(left.start || left.start_date || left.date),
    text(left.end || left.end_date || left.date),
    text(left.grade),
    text(left.note),
    text(left.color),
  ].join('::') === [
    text(right.id),
    text(right.title),
    text(right.schoolId || right.school_id || right.school),
    text(right.type),
    text(right.start || right.start_date || right.date),
    text(right.end || right.end_date || right.date),
    text(right.grade),
    text(right.note),
    text(right.color),
  ].join('::');
}

function normalizeType(value) {
  const next = text(value);
  if (next.includes('학교시험기간') || next.includes('시험기간')) return '시험기간';
  if (next.includes('영어시험일')) return '영어시험일';
  if (next.includes('수학시험일')) return '수학시험일';
  if (next.includes('시험')) return '시험기간';
  if (next.includes('체험') || next.includes('학습')) return '체험학습';
  if (next.includes('방학') || next.includes('개학')) return VACATION_MISC_EVENT_TYPE;
  if (next.includes('휴일') || next.includes('공휴일') || next.includes('대체휴일') || next.includes('휴강')) return VACATION_MISC_EVENT_TYPE;
  if (next.includes('팁스')) return '팁스';
  if (next.includes('학원') || next.includes('행사')) return '팁스';
  if (next.includes('기타')) return VACATION_MISC_EVENT_TYPE;
  return next || VACATION_MISC_EVENT_TYPE;
}

function todayString() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function diffDays(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / 86400000);
}

function clampDateRange(start, end) {
  if (!start && !end) return { start: '', end: '' };
  const safeStart = start || end;
  const safeEnd = end || start;
  return safeStart <= safeEnd ? { start: safeStart, end: safeEnd } : { start: safeEnd, end: safeStart };
}

function formatDisplayDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatDisplayDateWithWeekday(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_LABELS[date.getDay()]})`;
}

function formatEventDateRangeLabel(event) {
  if (!event) return '';
  return event.start === event.end
    ? formatDisplayDateWithWeekday(event.start)
    : `${formatDisplayDate(event.start)} - ${formatDisplayDate(event.end || event.start)}`;
}

function buildFloatingCardAnchor(anchorNode, options = {}) {
  const { width = 320, estimatedHeight = 240, gap = 12, minTop = 72 } = options;
  if (!anchorNode || typeof window === 'undefined') {
    return { top: minTop, left: 24, width };
  }

  const rect = anchorNode.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(24, viewportWidth - width - 24);
  let left = Math.min(Math.max(24, rect.left), maxLeft);
  let top = rect.bottom + gap;

  if (top + estimatedHeight > viewportHeight - 20) {
    top = Math.max(minTop, rect.top - estimatedHeight - gap);
  }

  return {
    top,
    left,
    width,
    maxHeight: Math.max(220, viewportHeight - top - 20),
  };
}

function buildVirtualAnchorPoint(x, y) {
  return {
    getBoundingClientRect() {
      return {
        left: x,
        right: x,
        top: y,
        bottom: y,
        width: 0,
        height: 0,
      };
    },
  };
}

function buildInlineComposerPlacement(anchorRect, containerRect, containerNode, options = {}) {
  const { width = 404, preferredHeight = 520, minimumHeight = 320, gap = 8, minTop = 72 } = options;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : containerRect.width;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : containerRect.height;
  const viewportLeft = 16;
  const viewportRight = viewportWidth - 16;
  const viewportBottom = viewportHeight - 16;
  const rightSpace = viewportRight - anchorRect.right;
  const leftSpace = anchorRect.left - viewportLeft;
  const maxWidth = Math.max(320, Math.min(width, viewportWidth - 32));
  const maxHeight = Math.max(minimumHeight, Math.min(preferredHeight, viewportBottom - minTop));
  let left = anchorRect.right + gap;

  if (rightSpace < maxWidth && leftSpace > rightSpace) {
    left = anchorRect.left - maxWidth - gap;
  }

  left = Math.min(Math.max(viewportLeft, left), Math.max(viewportLeft, viewportWidth - maxWidth - 16));

  let top = anchorRect.top;
  if (top + maxHeight > viewportBottom) {
    top = Math.max(minTop, viewportBottom - maxHeight);
  }
  if (anchorRect.bottom + maxHeight < viewportBottom && anchorRect.top < minTop) {
    top = Math.max(minTop, anchorRect.bottom + gap);
  }

  return {
    top,
    left,
    width: maxWidth,
    maxHeight,
  };
}

function buildInlinePopoverAnchor(anchorNode, containerNode, options = {}) {
  const { width = 404, preferredHeight = 520, minimumHeight = 320, gap = 6 } = options;
  if (!containerNode || !anchorNode) {
    return { top: 12, left: 12, width, maxHeight: preferredHeight };
  }

  const containerRect = containerNode.getBoundingClientRect();
  const anchorRect = anchorNode.getBoundingClientRect();
  return buildInlineComposerPlacement(anchorRect, containerRect, containerNode, {
    width,
    preferredHeight,
    minimumHeight,
    gap,
  });
}

function enumerateDateStrings(start, end) {
  const from = parseDate(start);
  const to = parseDate(end || start);
  if (!from || !to) return [];
  const safe = clampDateRange(formatDate(from), formatDate(to));
  const result = [];
  let cursor = parseDate(safe.start);
  const endDate = parseDate(safe.end);
  while (cursor <= endDate) {
    result.push(formatDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return result;
}

function buildAgendaGroups(events = []) {
  const groups = new Map();
  events.forEach((event) => {
    const key = event.start;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(event);
  });

  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, items]) => ({
      date,
      items: [...items].sort(
        (left, right) =>
          String(left.start || '').localeCompare(String(right.start || '')) ||
          String(left.title || '').localeCompare(String(right.title || ''), 'ko')
      ),
    }));
}

function buildMonthWeeks(currentDate, options = {}) {
  const { forceSixRows = false } = options;
  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());
  const weeks = [];
  let cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const days = [];
    for (let index = 0; index < 7; index += 1) {
      days.push(new Date(cursor));
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
  }

  if (forceSixRows) {
    while (weeks.length < 6) {
      const days = [];
      for (let index = 0; index < 7; index += 1) {
        days.push(new Date(cursor));
        cursor = addDays(cursor, 1);
      }
      weeks.push(days);
    }
  }

  return weeks;
}

function buildWeekSegments(week, events) {
  const weekStart = formatDate(week[0]);
  const weekEnd = formatDate(week[6]);
  const segments = events
    .filter((event) => event.start <= weekEnd && (event.end || event.start) >= weekStart)
    .map((event) => {
      const start = event.start < weekStart ? weekStart : event.start;
      const end = (event.end || event.start) > weekEnd ? weekEnd : event.end || event.start;
      const startIndex = week.findIndex((day) => formatDate(day) === start);
      const endIndex = week.findIndex((day) => formatDate(day) === end);
      return {
        event,
        startIndex,
        endIndex,
        isStartClipped: event.start < weekStart,
        isEndClipped: (event.end || event.start) > weekEnd,
      };
    })
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);

  const lanes = [];
  segments.forEach((segment) => {
    let laneIndex = 0;
    while (
      lanes[laneIndex] &&
      lanes[laneIndex].some(
        (item) => !(segment.endIndex < item.startIndex || segment.startIndex > item.endIndex)
      )
    ) {
      laneIndex += 1;
    }
    if (!lanes[laneIndex]) lanes[laneIndex] = [];
    lanes[laneIndex].push(segment);
    segment.laneIndex = laneIndex;
  });

  return { segments, laneCount: lanes.length };
}

function buildHiddenSegmentCounts(week, segments, visibleLaneCount) {
  return week.reduce((accumulator, day, dayIndex) => {
    const key = formatDate(day);
    accumulator[key] = segments.filter(
      (segment) =>
        segment.laneIndex >= visibleLaneCount &&
        dayIndex >= segment.startIndex &&
        dayIndex <= segment.endIndex
    ).length;
    return accumulator;
  }, {});
}

function getWeekLaneSpace(laneCount, visibleLaneCount) {
  const visibleLanes = Math.max(0, Math.min(laneCount, visibleLaneCount));
  if (!visibleLanes) return 0;
  return visibleLanes * 22 + Math.max(0, visibleLanes - 1) * 2 + 4;
}

function buildSelectionSegment(week, selectionRange) {
  if (!selectionRange?.start || !selectionRange?.end) {
    return null;
  }
  const weekStart = formatDate(week[0]);
  const weekEnd = formatDate(week[6]);
  if (selectionRange.end < weekStart || selectionRange.start > weekEnd) {
    return null;
  }

  const start = selectionRange.start < weekStart ? weekStart : selectionRange.start;
  const end = selectionRange.end > weekEnd ? weekEnd : selectionRange.end;
  const startIndex = week.findIndex((day) => formatDate(day) === start);
  const endIndex = week.findIndex((day) => formatDate(day) === end);

  if (startIndex < 0 || endIndex < 0) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    isStartClipped: selectionRange.start < weekStart,
    isEndClipped: selectionRange.end > weekEnd,
  };
}

function groupExamDetailsByEvent(details = []) {
  return details.reduce((accumulator, item) => {
    const key = item.academicEventId;
    if (!key) return accumulator;
    if (!accumulator[key]) accumulator[key] = [];
    accumulator[key].push(item);
    return accumulator;
  }, {});
}

function buildEmptyEvent(dateString, school) {
  return {
    id: '',
    title: '',
    schoolKey: schoolKey(school?.name || ''),
    schoolId: school?.id || '',
    school: school?.name || '',
    type: '시험기간',
    category: school?.category || 'all',
    grade: '',
    grades: [],
    start: dateString || todayString(),
    end: dateString || todayString(),
    periodCode: inferRoadmapPeriodCodeFromDate(dateString || todayString()),
    note: '',
    tags: [],
    color: school?.color || DEFAULT_EVENT_COLOR,
    examDetails: [],
  };
}

function appendScopeValue(currentValue, nextValue) {
  const current = text(currentValue);
  const next = text(nextValue);
  if (!next) return current;
  if (!current) return next;
  return current.includes(next) ? current : `${current}, ${next}`;
}

function buildExamQuickInsertOptions(detail, draft, schoolCatalog, curriculumData) {
  const year = Number(String(draft.start || todayString()).slice(0, 4)) || new Date().getFullYear();
  const school = schoolCatalog.find((item) => schoolKey(item.name) === detail.schoolKey) || null;
  const schoolId = school?.id || detail.schoolId || '';
  const subject = detail.subject || '';
  const grade = detail.grade || '';
  const textbookById = Object.fromEntries((curriculumData.textbooks || []).map((item) => [item.id, item]));
  const classById = Object.fromEntries((curriculumData.classes || []).map((item) => [item.id, item]));
  const matchedProfiles = (curriculumData.academicCurriculumProfiles || []).filter(
    (profile) =>
      String(profile.schoolId || '') === String(schoolId || '') &&
      String(profile.grade || '') === String(grade || '') &&
      String(profile.subject || '') === String(subject || '') &&
      Number(profile.academicYear || year) === year
  );

  const schoolTextbook = matchedProfiles
    .map((profile) => ({
      key: `school-main-${profile.id}`,
      label: text(profile.mainTextbookTitle || profile.mainTextbookPublisher || '교과서'),
      value: text([profile.mainTextbookTitle, profile.mainTextbookPublisher].filter(Boolean).join(' / ')),
    }))
    .filter((item) => item.value);

  const schoolSupplements = matchedProfiles.flatMap((profile) =>
    (curriculumData.academicSupplementMaterials || [])
      .filter((item) => item.profileId === profile.id)
      .map((item) => ({
        key: `school-sub-${item.id}`,
        label: text(item.title || item.publisher || '부교재'),
        value: text([item.title, item.publisher].filter(Boolean).join(' / ')),
      }))
      .filter((entry) => entry.value)
  );

  const matchedAcademyPlans = (curriculumData.academyCurriculumPlans || []).filter(
    (plan) =>
      String(plan.subject || '') === String(subject || '') &&
      Number(plan.academicYear || year) === year &&
      (!plan.academyGrade || String(plan.academyGrade) === String(grade))
  );

  const academyMain = matchedAcademyPlans
    .map((plan) => {
      const textbook = textbookById[plan.mainTextbookId] || null;
      const cls = classById[plan.classId] || null;
      return {
        key: `academy-main-${plan.id}`,
        label: text(textbook?.title || cls?.className || plan.note || '학원 메인'),
        value: text([textbook?.title, textbook?.publisher, cls?.className].filter(Boolean).join(' / ')),
      };
    })
    .filter((item) => item.value);

  const academySupplements = matchedAcademyPlans.flatMap((plan) =>
    (curriculumData.academyCurriculumMaterials || [])
      .filter((item) => item.planId === plan.id)
      .map((item) => ({
        key: `academy-sub-${item.id}`,
        label: text(item.title || item.publisher || '학원 보조'),
        value: text([item.title, item.publisher].filter(Boolean).join(' / ')),
      }))
      .filter((entry) => entry.value)
  );

  return {
    textbookScope: [
      { key: 'school-main-group', label: '학교 교과서', items: schoolTextbook },
      { key: 'academy-main-group', label: '학원 메인 교재', items: academyMain },
    ],
    supplementScope: [
      { key: 'school-sub-group', label: '학교 보출교재', items: schoolSupplements },
      { key: 'academy-sub-group', label: '학원 보조 교재', items: academySupplements },
    ],
  };
}

function readLocalStorageJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persistLocalStorageJson(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local storage write failures.
  }
}

function getEventColor(event, typeColorMap) {
  return typeColorMap[event.type] || event.color || DEFAULT_EVENT_COLOR;
}

function compareEvents(left, right) {
  return (
    String(left.start || '').localeCompare(String(right.start || '')) ||
    String(left.end || '').localeCompare(String(right.end || '')) ||
    String(left.title || '').localeCompare(String(right.title || ''), 'ko')
  );
}

function buildVisibleDateEventMap(events = [], rangeStart, rangeEnd) {
  const map = new Map();
  events.forEach((event) => {
    const safeStart = event.start < rangeStart ? rangeStart : event.start;
    const safeEnd = (event.end || event.start) > rangeEnd ? rangeEnd : event.end || event.start;
    enumerateDateStrings(safeStart, safeEnd).forEach((date) => {
      if (!map.has(date)) {
        map.set(date, []);
      }
      map.get(date).push(event);
    });
  });
  map.forEach((items, key) => {
    map.set(key, [...items].sort(compareEvents));
  });
  return map;
}

function AcademicTypeManagerModal({ open, definitions, onClose, onSave }) {
  const [draftDefinitions, setDraftDefinitions] = useState(normalizeEventTypeDefinitions(definitions));
  const [newTypeName, setNewTypeName] = useState('');

  useEffect(() => {
    setDraftDefinitions(normalizeEventTypeDefinitions(definitions));
    setNewTypeName('');
  }, [definitions, open]);

  if (!open) return null;

  const hasInvalidNames =
    draftDefinitions.some((definition) => !text(definition.name)) ||
    new Set(draftDefinitions.map((definition) => text(definition.name))).size !== draftDefinitions.length;

  const saveDefinitions = () => {
    if (hasInvalidNames) {
      return;
    }
    const nextDefinitions = draftDefinitions.map((definition, index) => ({
      ...definition,
      name: text(definition.name),
      color: pickEventTypeColor(definition.name, index),
    }));
    onSave(normalizeEventTypeDefinitions(nextDefinitions));
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="분류 관리"
      subtitle="일정 분류를 정리하고, 화면에 맞는 색상은 자동으로 맞춰 드립니다."
      maxWidth={760}
      actions={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="action-chip" onClick={onClose}>닫기</button>
          <button
            type="button"
            className="action-pill"
            onClick={saveDefinitions}
            disabled={hasInvalidNames}
          >
            <Save size={16} />
            저장
          </button>
        </div>
      }
    >
      <div className="academic-type-manager">
        <div className="academic-type-manager-intro">
          <div>
            <div className="academic-section-caption">정리 안내</div>
            <strong>색상은 자동으로 맞추고 분류 이름과 순서만 관리합니다.</strong>
          </div>
          <p>시험, 방학 같은 필수 분류는 고정하고 나머지는 자유롭게 추가하거나 정리할 수 있습니다.</p>
        </div>

        <div className="academic-type-manager-add">
          <div className="academic-type-manager-add-field">
            <span className="academic-section-caption">새 분류</span>
            <input
              className="styled-input"
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="새 분류 이름을 입력해 주세요"
            />
          </div>
          <button
            type="button"
            className="action-pill"
            onClick={() => {
              const name = text(newTypeName);
              if (!name || draftDefinitions.some((item) => item.name === name)) return;
              setDraftDefinitions((current) => [
                ...current,
                { id: DEFAULT_EVENT_TYPE_IDS[name] || createId(), name, color: pickEventTypeColor(name, current.length) },
              ]);
              setNewTypeName('');
            }}
          >
            <Plus size={16} />분류 추가
          </button>
        </div>

        <div className="academic-type-manager-list">
          {draftDefinitions.map((definition, index) => (
            <article key={definition.id} className="academic-type-manager-row">
              <div
                className="academic-type-manager-swatch"
                style={{ '--type-color': pickEventTypeColor(definition.name, index) }}
                aria-hidden="true"
              >
                <span />
              </div>
              <div className="academic-type-manager-copy">
                <input
                  className="styled-input"
                  value={definition.name}
                  disabled={NON_REMOVABLE_EVENT_TYPE_IDS.has(definition.id)}
                  onChange={(event) => {
                    setDraftDefinitions((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item
                      )
                    );
                  }}
                />
                <div className="academic-type-manager-note">
                  {NON_REMOVABLE_EVENT_TYPE_IDS.has(definition.id) ? '기본 분류' : '자동 색상 적용'}
                </div>
              </div>
              <div className="academic-type-manager-actions">
                <button type="button" className="action-chip" onClick={() => setDraftDefinitions((current) => moveArrayItem(current, index, -1))} disabled={index === 0 || NON_REMOVABLE_EVENT_TYPE_IDS.has(definition.id)}><ArrowUp size={14} /></button>
                <button type="button" className="action-chip" onClick={() => setDraftDefinitions((current) => moveArrayItem(current, index, 1))} disabled={index === draftDefinitions.length - 1 || NON_REMOVABLE_EVENT_TYPE_IDS.has(definition.id)}><ArrowDown size={14} /></button>
                <button
                  type="button"
                  className="action-chip"
                  onClick={() => setDraftDefinitions((current) => current.filter((item) => item.id !== definition.id))}
                  disabled={draftDefinitions.length <= 1 || NON_REMOVABLE_EVENT_TYPE_IDS.has(definition.id)}
                >
                  <Trash2 size={14} />삭제
                </button>
              </div>
            </article>
          ))}
        </div>

        {hasInvalidNames ? (
          <div className="academic-inline-state">빈 이름이나 중복된 분류명이 있으면 저장할 수 없습니다.</div>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function QuickInsertChips({ title, groups, onSelect, disabled }) {
  const visibleGroups = (groups || []).filter((group) => group.items?.length);
  if (!visibleGroups.length) return null;

  return (
    <div className="academic-quick-insert">
      <div className="academic-section-caption">{title}</div>
      <div className="academic-quick-groups">
        {visibleGroups.map((group) => (
          <div key={group.key} className="academic-quick-group">
            <div className="academic-quick-group-title">{group.label}</div>
            <div className="academic-quick-chip-wrap">
              {group.items.map((item) => (
                <button key={item.key} type="button" className="action-chip" disabled={disabled} onClick={() => onSelect(item.value)} title={item.value}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GradeMultiSelect({
  options,
  selectedValues,
  onChange,
  disabled,
  clearLabel = 'ALL',
  showClear = true,
}) {
  const normalizedSelected = [...new Set((selectedValues || []).map((item) => text(item)).filter(Boolean))];
  const normalizedOptions = [...new Set((options || []).map((item) => text(item)).filter(Boolean))];
  const allSelected =
    normalizedOptions.length > 0 && normalizedSelected.length === normalizedOptions.length
      && normalizedOptions.every((grade) => normalizedSelected.includes(grade));

  return (
    <div className="academic-chip-selector">
      {showClear ? (
        <button
          type="button"
          className={`academic-chip-option ${normalizedSelected.length === 0 || allSelected ? 'is-active' : ''}`}
          onClick={() => onChange(allSelected ? [] : normalizedOptions)}
          disabled={disabled}
        >
          {clearLabel}
        </button>
      ) : null}
      {normalizedOptions.map((grade) => {
        const active = normalizedSelected.includes(grade);
        return (
          <button
            key={grade}
            type="button"
            className={`academic-chip-option ${active ? 'is-active' : ''}`}
            onClick={() =>
              onChange(active ? normalizedSelected.filter((item) => item !== grade) : [...normalizedSelected, grade])
            }
            disabled={disabled}
          >
            {grade}
          </button>
        );
      })}
    </div>
  );
}

function AcademicEventEditorFields({
  draft,
  schoolCatalog,
  typeDefinitions,
  onChange,
  disabled,
  autoFocusTitle = false,
}) {
  const isAssessmentType = ASSESSMENT_EVENT_TYPES.has(normalizeType(draft.type));
  const visibleSchools =
    draft.category === 'all'
      ? schoolCatalog
      : schoolCatalog.filter((school) => school.category === draft.category);
  const selectedSchool = schoolCatalog.find((school) => schoolKey(school.name) === draft.schoolKey) || null;
  const gradeOptions = getGradeOptionsForSelection(draft.category, selectedSchool);

  const setDraftGrades = (nextGrades) => {
    const normalized = [...new Set((nextGrades || []).map((item) => text(item)).filter(Boolean))];
    onChange({
      grades: normalized,
      grade: joinGradeTokens(normalized),
    });
  };

  const applySchool = (nextSchoolKey) => {
    if (!nextSchoolKey || nextSchoolKey === 'all') {
      onChange({
        schoolKey: 'all',
        schoolId: '',
        school: '',
        grades: [],
        grade: '',
      });
      return;
    }
    const nextSchool = schoolCatalog.find((school) => schoolKey(school.name) === nextSchoolKey) || null;
    if (!nextSchool) return;
    const nextGrades = (draft.grades || []).filter((grade) => nextSchool.grades.includes(grade));
    onChange({
      schoolKey: nextSchoolKey,
      schoolId: nextSchool.id || '',
      school: nextSchool.name,
      color: nextSchool.color || draft.color,
      category: nextSchool.category || draft.category,
      grades: nextGrades,
      grade: joinGradeTokens(nextGrades),
    });
  };

  const changeCategory = (nextCategory) => {
    const currentSchool =
      nextCategory === 'all'
        ? null
        : schoolCatalog.find((school) => schoolKey(school.name) === draft.schoolKey && school.category === nextCategory) || null;
    const nextGradeOptions = getGradeOptionsForSelection(nextCategory, currentSchool);
    const nextGrades =
      nextCategory === 'all'
        ? []
        : (draft.grades || []).filter((grade) => nextGradeOptions.includes(grade));
    onChange({
      category: nextCategory,
      schoolKey: currentSchool ? schoolKey(currentSchool.name) : 'all',
      schoolId: currentSchool?.id || '',
      school: currentSchool?.name || '',
      color: currentSchool?.color || draft.color,
      grades: nextGrades,
      grade: joinGradeTokens(nextGrades),
    });
  };

  return (
    <>
      <div className="academic-editor-popover-grid academic-editor-popover-grid-2">
        <label className="academic-field">
          <span>제목</span>
          <input
            className="styled-input"
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="일정 이름"
            autoFocus={autoFocusTitle}
            disabled={disabled}
          />
        </label>
        <label className="academic-field">
          <span>분류</span>
          <select
            className="styled-input"
            value={draft.type}
            onChange={(event) => {
              const nextType = event.target.value;
              const nextIsAssessment = ASSESSMENT_EVENT_TYPES.has(normalizeType(nextType));
              onChange({
                type: nextType,
                periodCode: nextIsAssessment ? draft.periodCode || inferRoadmapPeriodCodeFromDate(draft.start) : '',
                grades: draft.grades || [],
                grade: joinGradeTokens(draft.grades || []),
              });
            }}
            disabled={disabled}
          >
            {typeDefinitions.map((type) => (
              <option key={type.id} value={type.name}>{type.name}</option>
            ))}
          </select>
        </label>
      </div>

      {isAssessmentType ? (
        <div className="academic-editor-popover-grid academic-editor-popover-grid-2">
          <label className="academic-field">
            <span>시기</span>
            <select
              className="styled-input"
              value={draft.periodCode || ''}
              onChange={(event) => onChange({ periodCode: event.target.value })}
              disabled={disabled}
            >
              <option value="">시기 선택</option>
              {FIXED_ROADMAP_PERIOD_OPTIONS.map((period) => (
                <option key={period.code} value={period.code}>{period.label}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="academic-editor-popover-grid academic-editor-popover-grid-2">
        <label className="academic-field">
          <span>시작일</span>
          <input
            className="styled-input"
            type="date"
            value={draft.start}
            onChange={(event) => onChange({ ...clampDateRange(event.target.value, draft.end) })}
            disabled={disabled}
          />
        </label>
        <label className="academic-field">
          <span>종료일</span>
          <input
            className="styled-input"
            type="date"
            value={draft.end}
            onChange={(event) => onChange({ ...clampDateRange(draft.start, event.target.value) })}
            disabled={disabled}
          />
        </label>
      </div>

      <div className={`academic-editor-popover-grid academic-editor-popover-grid-${draft.category !== 'all' ? '3' : '2'}`}>
        <label className="academic-field">
          <span>학교 구분</span>
          <select
            className="styled-input"
            value={draft.category}
            onChange={(event) => changeCategory(event.target.value)}
            disabled={disabled}
            data-testid="academic-editor-category-select"
          >
            {SCHOOL_CATEGORY_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="academic-field">
          <span>학교</span>
          <select
            className="styled-input"
            value={draft.schoolKey || 'all'}
            onChange={(event) => applySchool(event.target.value)}
            disabled={disabled}
            data-testid="academic-editor-school-select"
          >
            <option value="all">전체</option>
            {visibleSchools.map((school) => (
              <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
            ))}
          </select>
        </label>
        {draft.category !== 'all' && gradeOptions.length > 0 ? (
          <div className="academic-field academic-editor-grade-field">
            <span>학년</span>
            <div className="academic-grade-picker-panel" data-testid="academic-editor-grade-options">
              <GradeMultiSelect
                options={gradeOptions}
                selectedValues={draft.grades || []}
                onChange={setDraftGrades}
                disabled={disabled}
                showClear={false}
              />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function AcademicEventEditorActions({
  draft,
  canEdit,
  isSaving,
  onSave,
  onDelete,
  onOpenRoadmap,
}) {
  const canOpenRoadmap =
    canOpenRoadmapFromEvent(draft) &&
    typeof onOpenRoadmap === 'function' &&
    hasRoadmapContext(draft);
  const showDelete = Boolean(draft?.id && canEdit && onDelete);
  const showSave = Boolean(canEdit && onSave);

  return (
    <>
      {canOpenRoadmap ? (
        <button
          type="button"
          className="academic-icon-button"
          onClick={onOpenRoadmap}
          aria-label="학교 연간일정표 열기"
          title="학교 연간일정표 열기"
        >
          <BookOpen size={16} />
        </button>
      ) : null}
      {showSave ? (
        <button
          type="button"
          className="academic-icon-button is-primary"
          onClick={onSave}
          disabled={isSaving}
          aria-label={isSaving ? '저장 중' : '일정 저장'}
          title={isSaving ? '저장 중' : '일정 저장'}
        >
          <Save size={16} />
        </button>
      ) : null}
      {showDelete ? (
        <button
          type="button"
          className="academic-icon-button is-danger"
          onClick={onDelete}
          aria-label="일정 삭제"
          title="일정 삭제"
        >
          <Trash2 size={16} />
        </button>
      ) : null}
    </>
  );
}

function AcademicEventEditorCard({
  draft,
  headline,
  subline,
  schoolCatalog,
  typeDefinitions,
  onChange,
  onClose,
  onSave,
  onDelete,
  onOpenRoadmap,
  isSaving,
  canEdit,
  autoFocusTitle = false,
  showHeader = true,
}) {
  const selectedType = typeDefinitions.find((item) => item.name === draft.type) || typeDefinitions[0] || null;
  const headerActions = (
    <div className="academic-event-popover-actions">
      <AcademicEventEditorActions
        draft={draft}
        canEdit={canEdit}
        isSaving={isSaving}
        onSave={onSave}
        onDelete={onDelete}
        onOpenRoadmap={onOpenRoadmap}
      />
      <button type="button" className="academic-icon-button" onClick={onClose} aria-label="닫기">
        <X size={15} />
      </button>
    </div>
  );

  return (
    <>
      {showHeader ? (
        <div className="academic-event-popover-head academic-editor-popover-head">
          <span className="academic-event-popover-marker" style={{ background: selectedType?.color || DEFAULT_EVENT_COLOR }} />
          <div className="academic-event-popover-title-group">
            <strong>{headline}</strong>
            <span>{subline}</span>
          </div>
          {headerActions}
        </div>
      ) : null}

      <div className={`academic-event-popover-body academic-editor-popover-body ${showHeader ? '' : 'is-sheet'}`.trim()}>
        {!showHeader ? <div className="academic-editor-popover-sheet-actions">{headerActions}</div> : null}
        <AcademicEventEditorFields
          draft={draft}
          schoolCatalog={schoolCatalog}
          typeDefinitions={typeDefinitions}
          onChange={onChange}
          disabled={!canEdit}
          autoFocusTitle={autoFocusTitle}
        />
      </div>
    </>
  );
}

function AcademicEventModal({
  open,
  draft,
  anchor,
  schoolCatalog,
  typeDefinitions,
  onClose,
  onSave,
  onDelete,
  onOpenRoadmap,
  isSaving,
  canEdit,
  supportsExamDetails,
}) {
  const { isMobile } = useViewport();
  const [localDraft, setLocalDraft] = useState(draft);

  useEffect(() => {
    if (!draft) {
      setLocalDraft(draft);
      return;
    }
    const normalizedGrades = draft.grades?.length ? draft.grades : splitGradeTokens(draft.grade);
    setLocalDraft({
      ...draft,
      grades: normalizedGrades,
      grade: joinGradeTokens(normalizedGrades),
    });
  }, [draft]);

  if (!open || !localDraft) return null;

  const updateDraft = (patch) => {
    setLocalDraft((current) => ({ ...current, ...patch }));
  };

  const content = (
    <AcademicEventEditorCard
      draft={localDraft}
      headline={localDraft.title || '학사 일정'}
      subline={formatEventDateRangeLabel(localDraft)}
      schoolCatalog={schoolCatalog}
      typeDefinitions={typeDefinitions}
      onChange={updateDraft}
      onClose={onClose}
      onSave={() => onSave(localDraft)}
      onDelete={onDelete}
      onOpenRoadmap={
        onOpenRoadmap
          ? () => {
              onOpenRoadmap(buildRoadmapIntentFromEvent(localDraft));
              onClose();
            }
          : null
      }
      isSaving={isSaving}
      canEdit={canEdit}
      showHeader={!isMobile}
    />
  );

  if (!isMobile && anchor) {
    return (
      <section
        className="academic-inline-composer academic-event-editor-popover"
        style={{
          top: anchor.top,
          left: anchor.left,
          width: anchor.width,
          maxHeight: anchor.maxHeight,
        }}
      >
        {content}
      </section>
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={localDraft.id ? '학사 일정 편집' : '학사 일정 추가'}
      subtitle={formatEventDateRangeLabel(localDraft)}
      maxWidth={480}
      fullHeightOnMobile
      testId={localDraft.id ? 'calendar-editor-sheet' : 'calendar-create-sheet'}
    >
      <div className="academic-event-editor-sheet">{content}</div>
    </BottomSheet>
  );
}

function AcademicInlineComposer({
  draft,
  anchor,
  composerRef,
  schoolCatalog,
  typeDefinitions,
  onChange,
  onClose,
  onSave,
  onOpenRoadmap,
  isSaving,
  supportsExamDetails,
}) {
  if (!draft || !anchor) {
    return null;
  }

  return (
    <section
      ref={composerRef}
      className="academic-inline-composer academic-event-editor-popover"
      style={{
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        maxHeight: anchor.maxHeight,
      }}
    >
      <AcademicEventEditorCard
        draft={draft}
        headline={draft.title || '새 일정'}
        subline={anchor.label}
        schoolCatalog={schoolCatalog}
        typeDefinitions={typeDefinitions}
        onChange={onChange}
        onClose={onClose}
        onSave={() => onSave(draft)}
        onDelete={null}
        onOpenRoadmap={
          onOpenRoadmap
            ? () => {
                onOpenRoadmap(buildRoadmapIntentFromEvent(draft));
                onClose();
              }
            : null
        }
        isSaving={isSaving}
        canEdit
        autoFocusTitle
      />
    </section>
  );
}

function AcademicDayDialog({ open, title, events, onClose, typeColorMap }) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle="선택한 날짜에 일정을 빠르게 보고 바로 이어볼 수 있습니다."
      maxWidth={440}
      actions={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button type="button" className="action-chip" onClick={onClose}>닫기</button>
        </div>
      }
    >
      <div className="academic-day-dialog-list">
        {events.length === 0 ? (
          <div className="academic-empty-inline">등록된 일정이 아직 없습니다.</div>
        ) : (
          events.map((event) => (
            <button key={event.id} type="button" className="academic-day-dialog-item" onClick={event.onOpen}>
              <span className="academic-day-dialog-dot" style={{ background: getEventColor(event, typeColorMap) }} />
              <div className="academic-day-dialog-copy">
                <strong>{event.title}</strong>
                <span>{formatEventMetaSummary(event)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </BottomSheet>
  );
}

function AcademicDesktopPopoverShell({ anchor, className = '', children }) {
  if (!anchor) return null;

  return (
    <div
      className={`academic-desktop-popover ${className}`.trim()}
      style={{
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        maxHeight: anchor.maxHeight || undefined,
      }}
    >
      {children}
    </div>
  );
}

function AcademicEventPopover({ event, anchor, typeColorMap, canEdit, onClose, onEdit, onDelete, onOpenRoadmap }) {
  if (!event || !anchor) return null;

  const eventColor = getEventColor(event, typeColorMap);
  const metaTokens = formatEventMetaTokens(event);
  const canOpenRoadmap =
    canOpenRoadmapFromEvent(event) &&
    typeof onOpenRoadmap === 'function' &&
    hasRoadmapContext(event);

  return (
    <AcademicDesktopPopoverShell anchor={anchor} className="academic-event-popover">
      <div className="academic-event-popover-head">
        <span className="academic-event-popover-marker" style={{ background: eventColor }} />
        <div className="academic-event-popover-title-group">
          <strong>{event.title}</strong>
          <span>{formatEventDateRangeLabel(event)}</span>
        </div>
        <div className="academic-event-popover-actions">
          {canEdit ? (
            <>
              <button type="button" className="academic-icon-button" onClick={onEdit} aria-label="일정 편집">
                <Pencil size={15} />
              </button>
              {canOpenRoadmap ? (
                <button
                  type="button"
                  className="academic-icon-button"
                  onClick={onOpenRoadmap}
                  aria-label="학교 연간일정표 열기"
                  title="학교 연간일정표 열기"
                >
                  <BookOpen size={15} />
                </button>
              ) : null}
              <button type="button" className="academic-icon-button" onClick={onDelete} aria-label="일정 삭제">
                <Trash2 size={15} />
              </button>
            </>
          ) : canOpenRoadmap ? (
            <button
              type="button"
              className="academic-icon-button"
              onClick={onOpenRoadmap}
              aria-label="학교 연간일정표 열기"
              title="학교 연간일정표 열기"
            >
              <BookOpen size={15} />
            </button>
          ) : null}
          <button type="button" className="academic-icon-button" onClick={onClose} aria-label="닫기">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="academic-event-popover-body">
        <div className="academic-event-popover-row">
          <CalendarIcon size={15} />
          <span>{event.type || '기타 일정'}</span>
        </div>
        {metaTokens.length > 0 ? (
          <div className="academic-event-popover-tags">
            {metaTokens.map((token) => (
              <span key={token.key} className={`academic-event-popover-tag is-${token.tone}`}>
                {token.label}
              </span>
            ))}
          </div>
        ) : null}
        {text(event.note) ? <p className="academic-event-popover-note">{event.note}</p> : null}
      </div>
    </AcademicDesktopPopoverShell>
  );
}

function AcademicDayPopover({ title, events, anchor, typeColorMap, onClose, onOpenEvent }) {
  if (!anchor) return null;

  return (
    <AcademicDesktopPopoverShell anchor={anchor} className="academic-day-popover">
      <div className="academic-event-popover-head">
        <div className="academic-event-popover-title-group">
          <strong>{title}</strong>
          <span>{events.length}개 일정</span>
        </div>
        <button type="button" className="academic-icon-button" onClick={onClose} aria-label="닫기">
          <X size={15} />
        </button>
      </div>

      <div className="academic-day-popover-list">
        {events.length === 0 ? (
          <div className="academic-empty-inline">등록된 일정이 없습니다.</div>
        ) : (
          events.map((event) => (
            <button
              key={event.id}
              type="button"
              className="academic-day-popover-item"
              onClick={(clickEvent) => onOpenEvent(event, clickEvent)}
            >
              <span className="academic-day-popover-item-dot" style={{ background: getEventColor(event, typeColorMap) }} />
              <div className="academic-day-popover-item-copy">
                <strong>{event.title}</strong>
                <span>{formatEventDateRangeLabel(event)}</span>
              </div>
              {formatEventMetaTokens(event).length > 0 ? (
                <div className="academic-day-popover-item-meta" aria-hidden="true">
                  {formatEventMetaTokens(event).map((token) => (
                    <span key={token.key} className={`academic-event-popover-tag is-${token.tone}`}>
                      {token.label}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="academic-day-popover-item-chevron" aria-hidden="true">
                <ChevronRight size={15} />
              </div>
            </button>
          ))
        )}
      </div>
    </AcademicDesktopPopoverShell>
  );
}

function AcademicMonthGridV2({
  currentDate,
  weeks,
  weekCount,
  monthEvents,
  dayEventMap,
  typeColorMap,
  selectionAnchor,
  selectionRange,
  setSelectionAnchor,
  setSelectionRange,
  canWriteCalendar,
  draggedEventId,
  setDraggedEventId,
  onOpenDay,
  onOpenEvent,
  onCreateRange,
  onMoveEvent,
  visibleLaneCount,
  dayButtonRefs,
}) {
  return (
    <div className="academic-month-grid card-custom">
      <div className="academic-weekday-row">
        {WEEKDAY_LABELS.map((label, index) => (
          <div key={label} className={`academic-weekday ${index === 0 ? 'is-sunday' : ''} ${index === 6 ? 'is-saturday' : ''}`}>
            {label}
          </div>
        ))}
      </div>

      <div
        className="academic-month-weeks"
        style={{
          '--academic-week-count': weekCount || weeks.length,
          gridTemplateRows: `repeat(${weekCount || weeks.length}, minmax(0, 1fr))`,
        }}
      >
        {weeks.map((week) => {
          const { segments, laneCount } = buildWeekSegments(week, monthEvents);
          const hiddenCounts = buildHiddenSegmentCounts(week, segments, visibleLaneCount);
          const selectionSegment = buildSelectionSegment(week, selectionRange);
          const visibleLanes = Math.max(0, Math.min(laneCount, visibleLaneCount));
          const laneSpace = getWeekLaneSpace(laneCount, visibleLaneCount);

          return (
            <div
              key={week.map((day) => formatDate(day)).join('|')}
              className="academic-week-block"
              style={{ '--academic-lane-space': `${laneSpace}px` }}
            >
              <div className="academic-week-grid">
                <div className="academic-week-days">
                  {week.map((day) => {
                    const dateString = formatDate(day);
                    const inMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = dateString === todayString();
                    const dayEvents = dayEventMap.get(dateString) || [];
                    const rangeActive = selectionRange && dateString >= selectionRange.start && dateString <= selectionRange.end;

                    return (
                      <div
                        key={dateString}
                        ref={(node) => {
                          if (node) {
                            dayButtonRefs.current.set(dateString, node);
                          } else {
                            dayButtonRefs.current.delete(dateString);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`academic-day-cell ${!inMonth ? 'is-outside' : ''} ${rangeActive ? 'is-selected' : ''}`}
                        onMouseDown={() => {
                          if (!canWriteCalendar) return;
                          setSelectionAnchor(dateString);
                          setSelectionRange({ start: dateString, end: dateString });
                        }}
                        onMouseEnter={() => {
                          if (!selectionAnchor) return;
                          setSelectionRange(clampDateRange(selectionAnchor, dateString));
                        }}
                        onMouseUp={(event) => {
                          if (!selectionAnchor || !selectionRange) return;
                          onCreateRange(selectionRange.start, selectionRange.end, event);
                          setSelectionAnchor(null);
                          setSelectionRange(null);
                        }}
                        onDragOver={(event) => {
                          if (!draggedEventId) return;
                          event.preventDefault();
                        }}
                        onDrop={async (event) => {
                          event.preventDefault();
                          const targetId = draggedEventId;
                          setDraggedEventId('');
                          if (!targetId) return;
                          await onMoveEvent(targetId, dateString);
                        }}
                        onKeyDown={(event) => {
                          const keyMap = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                          if (event.key in keyMap) {
                            event.preventDefault();
                            const nextDate = formatDate(addDays(day, keyMap[event.key]));
                            dayButtonRefs.current.get(nextDate)?.focus();
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (dayEvents.length > 0) {
                              onOpenDay(dateString, dayButtonRefs.current.get(dateString));
                            } else if (canWriteCalendar) {
                              onCreateRange(dateString, dateString, dateString);
                            }
                          }
                        }}
                      >
                        <div className="academic-day-cell-header">
                          <span className={`academic-day-number ${isToday ? 'is-today' : ''}`}>{day.getDate()}</span>
                          {isToday ? <span className="academic-day-today-badge">오늘</span> : null}
                        </div>
                        {hiddenCounts[dateString] > 0 ? (
                          <button
                            type="button"
                            className="academic-day-more"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenDay(dateString, event.currentTarget);
                            }}
                          >
                            +{hiddenCounts[dateString]} 더보기
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {selectionSegment ? (
                  <div className="academic-selection-layer" aria-hidden="true">
                    <div
                      className={`academic-selection-bar ${selectionSegment.isStartClipped ? 'is-start-clipped' : ''} ${selectionSegment.isEndClipped ? 'is-end-clipped' : ''}`}
                      style={{
                        gridColumn: `${selectionSegment.startIndex + 1} / ${selectionSegment.endIndex + 2}`,
                      }}
                    />
                  </div>
                ) : null}

                {visibleLanes > 0 ? (
                  <div className="academic-week-lanes">
                    {Array.from({ length: visibleLanes }).map((_, laneIndex) => (
                      <div key={`lane-${laneIndex}`} className="academic-event-lane">
                        {segments.filter((segment) => segment.laneIndex === laneIndex).map((segment) => {
                          const metaSummary = formatEventMetaSummary(segment.event, { includeType: false });
                          const metaTokens = getCondensedEventMetaTokens(segment.event);

                          return (
                            <button
                              key={`${segment.event.id}-${laneIndex}`}
                              type="button"
                              data-testid={`calendar-event-${segment.event.id}`}
                              draggable={canWriteCalendar}
                              onDragStart={() => setDraggedEventId(segment.event.id)}
                              onDragEnd={() => setDraggedEventId('')}
                              onClick={(event) => onOpenEvent(segment.event, event)}
                              className="academic-event-bar"
                              style={{
                                gridColumn: `${segment.startIndex + 1} / ${segment.endIndex + 2}`,
                                '--event-color': getEventColor(segment.event, typeColorMap),
                              }}
                              aria-label={[segment.event.title, formatEventMetaSummary(segment.event, { includeType: false })].filter(Boolean).join(', ')}
                            >
                              <span className="academic-event-bar-edge">{segment.isStartClipped ? '~' : ''}</span>
                              <span className="academic-event-bar-content">
                                <span className="academic-event-bar-title">{segment.event.title}</span>
                                {metaTokens.length > 0 ? (
                                  <span className="academic-event-bar-meta">
                                    {metaTokens.map((token) => (
                                      <span key={token.key} className={`academic-event-bar-chip is-${token.tone}`}>
                                        {token.label}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </span>
                              <span className="academic-event-bar-edge">{segment.isEndClipped ? '~' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AcademicAgendaList({ groups, onOpenEvent, typeColorMap }) {
  return (
    <div className="academic-agenda-list" data-testid="calendar-agenda-list">
      {groups.length === 0 ? (
        <div className="card-custom academic-empty-state">
          <div className="academic-empty-state-title">조건에 맞는 일정이 없습니다.</div>
          <div className="academic-empty-state-copy">학교, 학년, 분류, 검색 조건을 조정해 보세요.</div>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.date} className="card-custom academic-agenda-group">
            <div className="academic-agenda-group-header">
              <div>
                <h3>{formatDisplayDateWithWeekday(group.date)}</h3>
                <p>{group.items.length}개 일정</p>
              </div>
            </div>
            <div className="academic-agenda-items">
              {group.items.map((event) => (
                <button key={event.id} type="button" className="academic-agenda-item" onClick={() => onOpenEvent(event)}>
                  <span className="academic-agenda-item-dot" style={{ background: getEventColor(event, typeColorMap) }} />
                  <div className="academic-agenda-item-copy">
                    <strong>{event.title}</strong>
                    <span>{[formatEventMetaSummary(event), event.start === event.end ? formatDisplayDate(event.start) : `${formatDisplayDate(event.start)} - ${formatDisplayDate(event.end)}`].filter(Boolean).join(' · ')}</span>
                  </div>
                  <span className="academic-type-pill">{event.type}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export default function AcademicCalendarView({
  data,
  dataService = sharedDataService,
  onOpenRoadmap,
  navigationIntent = null,
}) {
  const toast = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const { isStaff } = useAuth();
  const { isMobile } = useViewport();
  const uploadRef = useRef(null);
  const dayButtonRefs = useRef(new Map());
  const calendarMainRef = useRef(null);
  const inlineComposerRef = useRef(null);
  const monthWheelLockRef = useRef(0);
  const handledNavigationIntentRef = useRef(null);
  const pendingNavigationIntentRef = useRef(null);

  const canWriteCalendar = isStaff;
  const canUpload = isStaff;

  const [currentDate, setCurrentDate] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [mobileViewMode, setMobileViewMode] = useState('month');
  const currentView = 'month';
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSchoolKey, setSelectedSchoolKey] = useState('all');
  const [selectedGrades, setSelectedGrades] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState(DEFAULT_EVENT_TYPES);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingEventAnchor, setEditingEventAnchor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [workspaceSupport, setWorkspaceSupport] = useState({
    ready: true,
    missingTables: [],
    missingOptionalTables: [],
    checkedAt: null,
  });
  const [calendarWriteIssue, setCalendarWriteIssue] = useState(null);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [selectionRange, setSelectionRange] = useState(null);
  const [draggedEventId, setDraggedEventId] = useState('');
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [dayDialogDate, setDayDialogDate] = useState('');
  const [inlineComposerDraft, setInlineComposerDraft] = useState(null);
  const [inlineComposerAnchor, setInlineComposerAnchor] = useState(null);
  const [desktopEventPopover, setDesktopEventPopover] = useState(null);
  const [desktopDayPopover, setDesktopDayPopover] = useState(null);
  const [optimisticEvents, setOptimisticEvents] = useState([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('calendar');
  const [embeddedNavigationIntent, setEmbeddedNavigationIntent] = useState(null);

  const effectiveNavigationIntent = embeddedNavigationIntent || navigationIntent;

  useEffect(() => {
    if (!isMobile && mobileViewMode !== 'month') {
      setMobileViewMode('month');
    }
  }, [isMobile, mobileViewMode]);

  useEffect(() => {
    if (!navigationIntent?.nonce) {
      return;
    }
    setActiveWorkspaceTab('calendar');
    setEmbeddedNavigationIntent(null);
  }, [navigationIntent?.nonce]);

  const closeInlineComposer = () => {
    setInlineComposerDraft(null);
    setInlineComposerAnchor(null);
  };

  const closeDesktopPopovers = () => {
    setDesktopEventPopover(null);
    setDesktopDayPopover(null);
  };

  const schoolCatalog = useMemo(
    () => buildSchoolMaster(data.academicSchools, data.students),
    [data.academicSchools, data.students]
  );
  const schoolByKey = useMemo(
    () => Object.fromEntries(schoolCatalog.map((school) => [schoolKey(school.name), school])),
    [schoolCatalog]
  );
  const examDetailsByEvent = useMemo(
    () => groupExamDetailsByEvent(data.academicEventExamDetails || []),
    [data.academicEventExamDetails]
  );

  useEffect(() => {
    let cancelled = false;
    dataService
      .getAcademicWorkspaceSupport()
      .then((support) => {
        if (!cancelled) {
          setWorkspaceSupport(support);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceSupport({
            ready: true,
            missingTables: [],
            missingOptionalTables: ['academic_event_exam_details', 'academy_curriculum_plans', 'academy_curriculum_materials'],
            checkedAt: new Date(),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataService]);

  useEffect(() => {
    const handler = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 't') {
        event.preventDefault();
        setCurrentDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      }
      if (event.key === 'Escape') {
        setDayDialogDate('');
        setIsFilterSheetOpen(false);
        closeModal();
        closeInlineComposer();
        closeDesktopPopovers();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (isMobile) {
      closeInlineComposer();
    }
    closeModal();
    closeDesktopPopovers();
  }, [currentDate, isMobile]);

  useEffect(() => {
    if (!inlineComposerDraft) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (inlineComposerRef.current?.contains(target)) {
        return;
      }
      for (const node of dayButtonRefs.current.values()) {
        if (node?.contains?.(target)) {
          return;
        }
      }
      closeInlineComposer();
    };

    const handleScroll = () => {
      closeInlineComposer();
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [inlineComposerDraft]);

  useEffect(() => {
    if (!desktopEventPopover && !desktopDayPopover && !editingEventAnchor) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (target?.closest?.('.academic-desktop-popover') || target?.closest?.('.academic-event-editor-popover')) {
        return;
      }
      if (target?.closest?.('.academic-event-bar') || target?.closest?.('.academic-day-more')) {
        return;
      }
      closeDesktopPopovers();
      closeModal();
    };

    const handleScroll = () => {
      closeDesktopPopovers();
      closeModal();
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [desktopDayPopover, desktopEventPopover, editingEventAnchor]);

  const visibleSchools = useMemo(
    () => (selectedCategory === 'all' ? schoolCatalog : schoolCatalog.filter((school) => school.category === selectedCategory)),
    [schoolCatalog, selectedCategory]
  );
  const visibleSchoolKeys = useMemo(
    () => new Set(visibleSchools.map((school) => schoolKey(school.name))),
    [visibleSchools]
  );
  const gradeOptions = useMemo(() => {
    const selectedSchool = selectedSchoolKey === 'all' ? null : schoolByKey[selectedSchoolKey] || null;
    return getGradeOptionsForSelection(selectedCategory, selectedSchool);
  }, [schoolByKey, selectedCategory, selectedSchoolKey]);

  useEffect(() => {
    if (selectedSchoolKey !== 'all' && !visibleSchoolKeys.has(selectedSchoolKey)) {
      setSelectedSchoolKey('all');
    }
  }, [selectedSchoolKey, visibleSchoolKeys]);

  useEffect(() => {
    setSelectedGrades((current) => current.filter((grade) => gradeOptions.includes(grade)));
  }, [gradeOptions, selectedCategory]);

  useEffect(() => {
    if (!optimisticEvents.length) return;
    const persistedEvents = data.academicEvents || [];
    setOptimisticEvents((current) =>
      current.filter((optimisticEvent) => {
        const persisted = persistedEvents.find((event) => event.id === optimisticEvent.id);
        return !persisted || !isSameAcademicEventRecord(persisted, optimisticEvent);
      })
    );
  }, [data.academicEvents, optimisticEvents.length]);

  const typeColorMap = useMemo(
    () => Object.fromEntries(eventTypeOptions.map((item) => [item.name, item.color])),
    [eventTypeOptions]
  );

  const visibleAcademicEvents = useMemo(() => {
    const merged = new Map((data.academicEvents || []).map((event) => [event.id, event]));
    optimisticEvents.forEach((event) => {
      if (event?.id) {
        merged.set(event.id, event);
      }
    });
    return [...merged.values()];
  }, [data.academicEvents, optimisticEvents]);

  const events = useMemo(
    () =>
      visibleAcademicEvents.map((event) => {
        const school =
          schoolByKey[schoolKey(event.school)] ||
          schoolCatalog.find((item) => item.id === event.schoolId) ||
          null;
        const { noteText, meta } = stripNoteMeta(event.note);
        const derivedEnd = event.end || meta.rangeEnd || event.start;
        return {
          ...event,
          school: school?.name || event.school || '',
          schoolKey: schoolKey(school?.name || event.school),
          schoolId: school?.id || event.schoolId || '',
          end: derivedEnd,
          type: normalizeType(event.type),
          grade: event.grade || 'all',
          grades: splitGradeTokens(event.grade),
          category: school?.category || (event.grade && event.grade !== 'all' ? inferSchoolCategoryFromGrade(event.grade) : 'all'),
          color: event.color || school?.color || DEFAULT_EVENT_COLOR,
          note: noteText,
          tags: normalizeTags(meta.tags || []),
          meta,
          academicYear:
            Number(meta.academicYear || String(event.start || derivedEnd || '').slice(0, 4)) ||
            new Date().getFullYear(),
          roadmapPeriodCode: text(meta.roadmapPeriodCode),
          roadmapSubject: text(meta.roadmapSubject),
          periodCode: text(meta.roadmapPeriodCode) || inferRoadmapPeriodCode({ ...event, note: noteText, meta }),
          examDetails: (examDetailsByEvent[event.id] || []).map((detail) => ({
            ...detail,
            schoolKey: schoolKey(schoolCatalog.find((row) => row.id === detail.schoolId)?.name || event.school),
            examDateStatus: detail.examDateStatus || detail.exam_date_status || (detail.examDate ? 'exact' : 'tbd'),
          })),
        };
      }),
    [visibleAcademicEvents, examDetailsByEvent, schoolByKey, schoolCatalog]
  );

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (selectedCategory !== 'all' && schoolByKey[event.schoolKey]?.category !== selectedCategory) return false;
      if (!selectedTypes.includes(event.type)) return false;
      return true;
    });
  }, [events, schoolByKey, selectedCategory, selectedTypes]);

  const monthWeeks = useMemo(() => buildMonthWeeks(currentDate), [currentDate]);
  const miniCalendarWeeks = useMemo(() => buildMonthWeeks(currentDate, { forceSixRows: true }), [currentDate]);
  const gridStart = formatDate(monthWeeks[0][0]);
  const gridEnd = formatDate(monthWeeks[monthWeeks.length - 1][6]);
  const monthStart = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  const monthEnd = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
  const monthLabel = `${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월`;

  const monthEvents = useMemo(
    () => filteredEvents.filter((event) => event.start <= gridEnd && (event.end || event.start) >= gridStart).sort(compareEvents),
    [filteredEvents, gridEnd, gridStart]
  );
  const agendaEvents = useMemo(
    () => filteredEvents.filter((event) => event.start <= monthEnd && (event.end || event.start) >= monthStart).sort(compareEvents),
    [filteredEvents, monthEnd, monthStart]
  );
  const agendaGroups = useMemo(() => buildAgendaGroups(agendaEvents), [agendaEvents]);
  const dayEventMap = useMemo(() => buildVisibleDateEventMap(monthEvents, gridStart, gridEnd), [monthEvents, gridEnd, gridStart]);
  const selectedSchoolLabel = selectedCategory === 'all'
    ? '전체 학교'
    : `${getSchoolCategoryLabel(selectedCategory, '전체')} 전체`;
  const writeState = useMemo(
    () => (calendarWriteIssue ? getAcademicCalendarWriteState(calendarWriteIssue, { canWriteCalendar }) : null),
    [calendarWriteIssue, canWriteCalendar]
  );
  const supportsExamDetails = false;

  const ensureSchoolRecord = async (draft) => {
    const existing = schoolByKey[draft.schoolKey];
    if (existing?.id) return existing;
    if (!existing?.name) {
      throw new Error('학생 정보에서 먼저 학교를 등록해 주세요.');
    }
    const [savedSchool] = await dataService.upsertAcademicSchools([
      {
        id: createId(),
        name: existing.name,
        category: existing.category || inferSchoolCategoryFromGrade(draft.grade),
        color: existing.color || DEFAULT_EVENT_COLOR,
        sortOrder: 0,
      },
    ]);
    return savedSchool;
  };

  const closeModal = () => {
    setEditingEvent(null);
    setEditingEventAnchor(null);
  };

  const buildCreateDraft = (start, end = start) => {
    const defaultSchool = selectedSchoolKey === 'all' ? null : schoolByKey[selectedSchoolKey];
    return {
      ...buildEmptyEvent(start, defaultSchool),
      end,
      category: selectedCategory === 'all' ? defaultSchool?.category || 'all' : selectedCategory,
      schoolKey: selectedSchoolKey === 'all' ? 'all' : defaultSchool?.name ? schoolKey(defaultSchool.name) : 'all',
      schoolId: selectedSchoolKey === 'all' ? '' : defaultSchool?.id || '',
      school: selectedSchoolKey === 'all' ? '' : defaultSchool?.name || '',
      grade: selectedGrades.length === 1 ? selectedGrades[0] : '',
      grades: selectedGrades,
      type: selectedTypes[0] || eventTypeOptions[0]?.name || '시험기간',
    };
  };

  const buildInlineComposerAnchor = (anchorSource, start, end) => {
    const containerNode = calendarMainRef.current;
    const anchorNode =
      anchorSource && typeof anchorSource.clientX === 'number' && typeof anchorSource.clientY === 'number'
        ? buildVirtualAnchorPoint(anchorSource.clientX, anchorSource.clientY)
        : anchorSource && typeof anchorSource.getBoundingClientRect === 'function'
          ? anchorSource
          : dayButtonRefs.current.get(anchorSource || start);
    const width = 404;
    const label =
      start === end
        ? formatDisplayDateWithWeekday(start)
        : `${formatDisplayDate(start)} - ${formatDisplayDate(end)}`;

    if (!containerNode || !anchorNode) {
      return { top: 12, left: 12, width, maxHeight: 560, label };
    }

    const containerRect = containerNode.getBoundingClientRect();
    const anchorRect = anchorNode.getBoundingClientRect();
    const placement = buildInlineComposerPlacement(anchorRect, containerRect, containerNode, {
      width: 452,
      preferredHeight: 520,
      minimumHeight: 340,
      gap: 8,
    });

    return {
      top: placement.top,
      left: placement.left,
      width: placement.width,
      maxHeight: placement.maxHeight,
      label,
    };
  };

  const buildEditorAnchor = (anchorNode = null) => {
    const containerNode = calendarMainRef.current;
    const placement = buildInlinePopoverAnchor(anchorNode, containerNode, {
      width: 452,
      preferredHeight: 540,
      minimumHeight: 360,
      gap: 8,
    });

    return {
      top: placement.top,
      left: placement.left,
      width: placement.width,
      maxHeight: placement.maxHeight,
    };
  };

  const openCreateComposer = (start, end = start, anchorSource = start) => {
    const nextDraft = buildCreateDraft(start, end);
    closeModal();
    closeDesktopPopovers();
    if (isMobile || currentView !== 'month') {
      setEditingEvent(nextDraft);
      return;
    }
    setInlineComposerDraft(nextDraft);
    setInlineComposerAnchor(buildInlineComposerAnchor(anchorSource, start, end));
  };

  const updateInlineComposerDraft = (patch) => {
    setInlineComposerDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const openDayEvents = (dateString, anchorNode = null) => {
    closeInlineComposer();
    if (isMobile || currentView !== 'month') {
      setDayDialogDate(dateString);
      return;
    }
    const eventCount = (dayEventMap.get(dateString) || []).length;
    setDesktopEventPopover(null);
    setDesktopDayPopover({
      date: dateString,
      title: formatDisplayDateWithWeekday(dateString),
      anchor: buildFloatingCardAnchor(anchorNode || dayButtonRefs.current.get(dateString), {
        width: 520,
        estimatedHeight: Math.min(760, 116 + eventCount * 74),
      }),
    });
  };

  const openExistingEvent = (event, anchorSource = null) => {
    closeInlineComposer();
    const resolvedAnchor =
      anchorSource && typeof anchorSource.clientX === 'number' && typeof anchorSource.clientY === 'number'
        ? buildVirtualAnchorPoint(anchorSource.clientX, anchorSource.clientY)
        : anchorSource;
    if (isMobile || currentView !== 'month') {
      setEditingEventAnchor(null);
      setEditingEvent(event);
      return;
    }
    setDayDialogDate('');
    setDesktopDayPopover(null);
    setDesktopEventPopover({
      event,
      triggerAnchor: resolvedAnchor,
      anchor: buildFloatingCardAnchor(resolvedAnchor, {
        width: 372,
        estimatedHeight: 268,
      }),
    });
  };

  const openEventEditor = (event, anchorSource = null) => {
    if (!event) return;
    closeDesktopPopovers();
    const resolvedAnchor =
      anchorSource && typeof anchorSource.clientX === 'number' && typeof anchorSource.clientY === 'number'
        ? buildVirtualAnchorPoint(anchorSource.clientX, anchorSource.clientY)
        : anchorSource;
    if (!isMobile && resolvedAnchor) {
      setEditingEventAnchor(buildEditorAnchor(resolvedAnchor));
    } else {
      setEditingEventAnchor(null);
    }
    setEditingEvent(event);
  };

  useEffect(() => {
    const nonce = effectiveNavigationIntent?.nonce;
    if (!effectiveNavigationIntent || !nonce || handledNavigationIntentRef.current === nonce) {
      return;
    }

    handledNavigationIntentRef.current = nonce;

    const matchedSchool =
      schoolByKey[effectiveNavigationIntent.schoolKey] ||
      schoolCatalog.find((school) => school.id === effectiveNavigationIntent.schoolId) ||
      schoolCatalog.find((school) => schoolKey(school.name) === schoolKey(effectiveNavigationIntent.schoolName)) ||
      null;
    const targetEvent = effectiveNavigationIntent.eventId
      ? events.find((event) => event.id === effectiveNavigationIntent.eventId) || null
      : null;
    const targetGrades = effectiveNavigationIntent.grade
      ? [effectiveNavigationIntent.grade]
      : (targetEvent ? getEventGradeTokens(targetEvent) : []);
    const targetType = text(effectiveNavigationIntent.eventType || targetEvent?.type);
    const targetDate = text(effectiveNavigationIntent.date || targetEvent?.start || targetEvent?.date);
    const targetCategory =
      text(effectiveNavigationIntent.schoolCategory) ||
      matchedSchool?.category ||
      (targetGrades[0] ? inferSchoolCategoryFromGrade(targetGrades[0]) : 'all');
    const isVisibleUnderCurrentFilters = targetEvent
      ? filteredEvents.some((event) => event.id === targetEvent.id)
      : false;

    setSelectedCategory(targetCategory || 'all');

    if (targetDate) {
      const parsedDate = parseDate(targetDate);
      if (parsedDate) {
        setCurrentDate(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
      }
    }

    if (targetEvent && !isVisibleUnderCurrentFilters) {
      pendingNavigationIntentRef.current = null;
      setEditingEventAnchor(null);
      setEditingEvent(targetEvent);
      return;
    }

    pendingNavigationIntentRef.current = {
      eventId: text(effectiveNavigationIntent.eventId),
      date: targetDate,
    };
  }, [effectiveNavigationIntent, events, filteredEvents, schoolByKey, schoolCatalog]);

  useEffect(() => {
    if (!embeddedNavigationIntent?.nonce) {
      return;
    }
    if (handledNavigationIntentRef.current === embeddedNavigationIntent.nonce) {
      setEmbeddedNavigationIntent(null);
    }
  }, [embeddedNavigationIntent]);

  useEffect(() => {
    const pendingIntent = pendingNavigationIntentRef.current;
    if (!pendingIntent) {
      return;
    }

    const targetDate = text(pendingIntent.date);
    if (!targetDate) {
      pendingNavigationIntentRef.current = null;
      return;
    }

    const targetEvent = pendingIntent.eventId
      ? events.find((event) => event.id === pendingIntent.eventId) || null
      : null;
    const targetMonth = parseDate(targetEvent?.start || targetDate);
    if (!targetMonth) {
      pendingNavigationIntentRef.current = null;
      return;
    }
    if (
      currentDate.getFullYear() !== targetMonth.getFullYear() ||
      currentDate.getMonth() !== targetMonth.getMonth()
    ) {
      return;
    }

    pendingNavigationIntentRef.current = null;
    if (targetEvent) {
      const isVisibleUnderCurrentFilters = filteredEvents.some((event) => event.id === targetEvent.id);
      if (isVisibleUnderCurrentFilters) {
        openExistingEvent(targetEvent, dayButtonRefs.current.get(targetDate) || null);
      } else {
        setEditingEventAnchor(null);
        setEditingEvent(targetEvent);
      }
      return;
    }
    openDayEvents(targetDate, dayButtonRefs.current.get(targetDate) || null);
  }, [currentDate, events, filteredEvents, openDayEvents, openExistingEvent]);

  const handleCalendarWheel = (event) => {
    if (isMobile) return;
    const target = event.target;
    if (
      target?.closest?.(
        '.academic-event-editor-popover, .academic-inline-composer, .academic-desktop-popover, .styled-input, select, textarea'
      )
    ) {
      return;
    }
    if (Math.abs(event.deltaY) < 28) return;

    const now = Date.now();
    if (now - monthWheelLockRef.current < 420) {
      event.preventDefault();
      return;
    }
    monthWheelLockRef.current = now;
    event.preventDefault();
    setCurrentDate((current) =>
      new Date(current.getFullYear(), current.getMonth() + (event.deltaY > 0 ? 1 : -1), 1)
    );
  };

  const saveEvent = async (nextDraft, options = {}) => {
    const { source = 'modal' } = options;
    if (!nextDraft) return;
    if (!canWriteCalendar) {
      toast.info('현재 계정은 학사 일정을 저장할 수 없습니다.');
      return;
    }
    if (!text(nextDraft.title)) {
      toast.info('일정 제목을 입력해 주세요.');
      return;
    }

    try {
      const normalizedType = normalizeType(nextDraft.type);
      const requiresSchoolAndGrade = SCHOOL_GRADE_REQUIRED_EVENT_TYPES.has(normalizedType);
      const hasAssignedSchool = Boolean(
        (text(nextDraft.schoolKey) && text(nextDraft.schoolKey) !== 'all') || text(nextDraft.school)
      );
      const selectedSchool =
        schoolByKey[nextDraft.schoolKey] ||
        schoolCatalog.find((school) => school.id === nextDraft.schoolId) ||
        schoolCatalog.find((school) => schoolKey(school.name) === schoolKey(nextDraft.school)) ||
        null;
      const normalizedGradeValues = [...new Set((nextDraft.grades || splitGradeTokens(nextDraft.grade)).map((grade) => text(grade)).filter(Boolean))];
      if (requiresSchoolAndGrade && !hasAssignedSchool) {
        const schoolRequiredMessage =
          normalizedType === '체험학습'
            ? '체험학습은 학교를 선택해 주세요.'
            : normalizedType === VACATION_MISC_EVENT_TYPE
              ? '방학·휴일·기타 일정은 학교를 선택해 주세요.'
              : '시험 관련 일정은 학교를 선택해 주세요.';
        toast.info(
          schoolRequiredMessage
        );
        return;
      }
      if (ASSESSMENT_EVENT_TYPES.has(normalizedType) && !text(nextDraft.periodCode)) {
        toast.info('시험 관련 일정은 시기를 선택해 주세요.');
        return;
      }
      if (requiresSchoolAndGrade && normalizedGradeValues.length === 0) {
        const gradeRequiredMessage =
          normalizedType === '체험학습'
            ? '체험학습은 학년을 선택해 주세요.'
            : normalizedType === VACATION_MISC_EVENT_TYPE
              ? '방학·휴일·기타 일정은 학년을 선택해 주세요.'
              : '시험 관련 일정은 학년을 선택해 주세요.';
        toast.info(
          gradeRequiredMessage
        );
        return;
      }

      setIsSaving(true);
      const school = hasAssignedSchool
        ? await ensureSchoolRecord({
            ...nextDraft,
            grade: joinGradeTokens(normalizedGradeValues),
          })
        : null;
      const normalizedGrades = joinGradeTokens(normalizedGradeValues);
      const roadmapSubject = ROADMAP_SUBJECT_BY_EVENT_TYPE[normalizedType] || '';
      const academicYear =
        Number(String(nextDraft.start || nextDraft.end || todayString()).slice(0, 4)) ||
        new Date().getFullYear();
      const payload = {
        title: text(nextDraft.title),
        schoolId: school?.id || null,
        school: school?.name || '',
        type: normalizedType,
        start: nextDraft.start,
        end: nextDraft.end || nextDraft.start,
        grade: normalizedGrades || 'all',
        note: mergeNoteMeta(nextDraft.note, {
          tags: normalizeTags(nextDraft.tags || []),
          rangeEnd: nextDraft.end && nextDraft.end !== nextDraft.start ? nextDraft.end : '',
          roadmapPeriodCode: ASSESSMENT_EVENT_TYPES.has(normalizedType) ? text(nextDraft.periodCode) : '',
          roadmapSubject,
          academicYear: ASSESSMENT_EVENT_TYPES.has(normalizedType) ? academicYear : '',
        }),
        color: getEventColor(nextDraft, typeColorMap),
      };

      const savedEvent = nextDraft.id
        ? await dataService.updateAcademicEvent(nextDraft.id, payload).then(() => ({ id: nextDraft.id, ...payload }))
        : await dataService.addAcademicEvent(payload);

      setOptimisticEvents((current) => {
        const optimisticEvent = {
          id: savedEvent?.id || nextDraft.id || createId(),
          ...payload,
        };
        return [...current.filter((event) => event.id !== optimisticEvent.id), optimisticEvent];
      });

      if (supportsExamDetails && ASSESSMENT_EVENT_TYPES.has(payload.type)) {
        const examDetails = (nextDraft.examDetails || []).map((detail, index) => ({
          ...detail,
          schoolId: schoolByKey[detail.schoolKey]?.id || detail.schoolId || school?.id || null,
          examDate: detail.examDateStatus === 'tbd' ? null : detail.examDate || null,
          examDateStatus: detail.examDateStatus || (detail.examDate ? 'exact' : 'tbd'),
          sortOrder: index,
        }));
        await dataService.replaceAcademicEventExamDetails(savedEvent.id, examDetails);
      }

      toast.success(nextDraft.id ? '학사 일정을 수정했습니다.' : '학사 일정을 추가했습니다.');
      setCalendarWriteIssue(null);
      closeDesktopPopovers();
      if (source === 'inline') {
        closeInlineComposer();
      } else {
        closeModal();
      }
    } catch (error) {
      setCalendarWriteIssue(error);
      toast.error(`학사 일정 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteEventByTarget = async (targetEvent) => {
    if (!targetEvent?.id) return;
    const approved = await confirm({
      title: '일정을 삭제할까요?',
      description: '삭제하면 해당 일정이 캘린더에서 사라집니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger',
    });
    if (!approved) return;

    setIsSaving(true);
    try {
      if (supportsExamDetails) {
        await dataService.replaceAcademicEventExamDetails(targetEvent.id, []);
      }
      await dataService.deleteAcademicEvent(targetEvent.id);
      setOptimisticEvents((current) => current.filter((event) => event.id !== targetEvent.id));
      toast.success('학사 일정을 삭제했습니다.');
      setCalendarWriteIssue(null);
      if (editingEvent?.id === targetEvent.id) {
        closeModal();
      }
      if (desktopEventPopover?.event?.id === targetEvent.id) {
        closeDesktopPopovers();
      }
    } catch (error) {
      setCalendarWriteIssue(error);
      toast.error(`학사 일정 삭제에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteEvent = async () => {
    await deleteEventByTarget(editingEvent);
    return;
    if (!editingEvent?.id) return;
    const approved = await confirm({
      title: '일정을 삭제할까요?',
      description: '삭제하면 연결된 시험 세부사항도 함께 사라집니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger',
    });
    if (!approved) return;

    setIsSaving(true);
    try {
      if (supportsExamDetails) {
        await dataService.replaceAcademicEventExamDetails(editingEvent.id, []);
      }
      await dataService.deleteAcademicEvent(editingEvent.id);
      toast.success('학사 일정을 삭제했습니다.');
      setCalendarWriteIssue(null);
      closeModal();
    } catch (error) {
      setCalendarWriteIssue(error);
      toast.error(`학사 일정 삭제에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const moveEvent = async (eventId, nextStart) => {
    if (!canWriteCalendar) return;
    const target = events.find((item) => item.id === eventId);
    if (!target) return;
    const duration = diffDays(target.start, target.end || target.start);
    const nextEnd = formatDate(addDays(parseDate(nextStart), duration));
    try {
      await dataService.updateAcademicEvent(target.id, {
        start: nextStart,
        end: nextEnd,
        note: mergeNoteMeta(target.note, {
          tags: normalizeTags(target.tags || []),
          rangeEnd: nextEnd !== nextStart ? nextEnd : '',
        }),
      });
      toast.success('일정 날짜를 옮겼습니다.');
      setCalendarWriteIssue(null);
    } catch (error) {
      setCalendarWriteIssue(error);
      toast.error(`일정 이동에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const downloadTemplate = async () => {
    setIsBusy(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet((schoolCatalog || []).map((school) => ({ '학교명': school.name, '학교 구분': getSchoolCategoryLabel(school.category), '색상': school.color }))),
        '학교목록'
      );
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), '교과정보');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), '보출교재');
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet([
          {
            '제목': '1학기 중간고사',
            '학교명': schoolCatalog[0]?.name || '',
            '학년': schoolCatalog[0]?.grades?.[0] || '고1',
            '분류': '시험기간',
            '시작일': `${new Date().getFullYear()}-04-22`,
            '종료일': `${new Date().getFullYear()}-04-24`,
            '비고': '',
            '과목': '영어',
            '시험일': '',
            '교과서범위': '',
            '보출교재범위': '',
            '기타범위': '',
          },
        ]),
        '학사일정'
      );
      XLSX.writeFile(workbook, 'TIPS-학사일정-템플릿.xlsx');
      toast.success('학사 일정 템플릿을 다운로드했습니다.');
    } catch (error) {
      toast.error(`템플릿 다운로드에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const uploadWorkbook = async (file) => {
    if (!file) return;
    if (!canUpload) {
      toast.info('데이터 업로드는 staff/admin만 사용할 수 있습니다.');
      return;
    }

    setIsBusy(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const format = detectAcademicWorkbookFormat(XLSX, workbook);
      const getRows = (sheetName) => (workbook.Sheets[sheetName] ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) : []);

      let uploadPayload;
      if (format === 'matrix-high-school') {
        uploadPayload = parseHighSchoolMatrixWorkbook(XLSX, workbook);
      } else {
        uploadPayload = {
          schools: getRows('학교목록').map((row) => ({
            name: row['학교명'] || '',
            category: row['학교 구분'] || row['구분'] || '',
            color: row['색상'] || '',
          })),
          profiles: getRows('교과정보').map((row) => ({
            schoolName: row['학교명'] || '',
            grade: row['학년'] || '',
            subject: row['과목'] || '',
            mainTextbookTitle: row['교과서'] || '',
            mainTextbookPublisher: row['출판사'] || '',
            note: row['비고'] || '',
          })),
          materials: getRows('보출교재').map((row, index) => ({
            schoolName: row['학교명'] || '',
            grade: row['학년'] || '',
            subject: row['과목'] || '',
            title: row['보출교재'] || '',
            publisher: row['출판사'] || '',
            note: row['비고'] || '',
            sortOrder: index,
          })),
          events: getRows('학사일정').map((row) => ({
            title: row['제목'] || '',
            schoolName: row['학교명'] || '',
            grade: row['학년'] || '',
            type: row['분류'] || '',
            start: row['시작일'] || '',
            end: row['종료일'] || '',
            note: row['비고'] || '',
            examDetails:
              row['과목'] || row['시험일']
                ? [
                    {
                      id: createId(),
                      schoolName: row['학교명'] || '',
                      grade: row['학년'] || '',
                      subject: row['과목'] || '',
                      examDateStatus: row['시험일'] ? 'exact' : 'tbd',
                      examDate: row['시험일'] || '',
                      textbookScope: row['교과서범위'] || '',
                      supplementScope: row['보출교재범위'] || '',
                      otherScope: row['기타범위'] || '',
                      note: '',
                    },
                  ]
                : [],
          })),
        };
      }

      const existingSchools = new Map((data.academicSchools || []).map((school) => [schoolKey(school.name), school]));
      const schoolRows = new Map();
      [...(uploadPayload.schools || []), ...(uploadPayload.profiles || []), ...(uploadPayload.materials || []), ...(uploadPayload.events || [])].forEach((row) => {
        const name = text(row.name || row.schoolName);
        if (!name) return;
        const matched = existingSchools.get(schoolKey(name));
        schoolRows.set(schoolKey(name), {
          id: matched?.id || createId(),
          name,
          category: row.category || matched?.category || inferSchoolCategoryFromGrade(row.grade),
          color: row.color || matched?.color || DEFAULT_EVENT_COLOR,
          sortOrder: matched?.sortOrder || schoolRows.size,
        });
      });

      const savedSchools = schoolRows.size > 0 ? await dataService.upsertAcademicSchools([...schoolRows.values()]) : [];
      const savedSchoolMap = new Map(savedSchools.map((school) => [schoolKey(school.name), school]));

      const profiles = (uploadPayload.profiles || []).map((profile) => {
        const school = savedSchoolMap.get(schoolKey(profile.schoolName));
        if (!school) return null;
        return {
          academicYear: new Date().getFullYear(),
          schoolId: school.id,
          grade: profile.grade,
          subject: profile.subject,
          mainTextbookTitle: profile.mainTextbookTitle,
          mainTextbookPublisher: profile.mainTextbookPublisher,
          note: profile.note,
        };
      }).filter(Boolean);

      const savedProfiles = profiles.length > 0 ? await dataService.bulkUpsertAcademicCurriculumProfiles(profiles) : [];
      const savedProfileMap = new Map(savedProfiles.map((profile) => [[profile.schoolId, profile.grade, profile.subject].join('::'), profile]));

      for (const material of uploadPayload.materials || []) {
        const school = savedSchoolMap.get(schoolKey(material.schoolName));
        const profile = savedProfileMap.get([school?.id, material.grade, material.subject].join('::'));
        if (profile) {
          const existing = (data.academicSupplementMaterials || []).filter((item) => item.profileId === profile.id);
          await dataService.replaceAcademicSupplementMaterials(profile.id, [...existing, material]);
        }
      }

      const eventPayload = (uploadPayload.events || []).map((event) => {
        const school = savedSchoolMap.get(schoolKey(event.schoolName));
        if (!school || !text(event.title) || !text(event.start)) return null;
        return {
          id: createId(),
          title: event.title,
          schoolId: school.id,
          school: school.name,
          type: normalizeType(event.type),
          start: event.start,
          end: event.end || event.start,
          note: event.note || '',
          grade: event.grade || 'all',
          color: school.color || DEFAULT_EVENT_COLOR,
          examDetails: (event.examDetails || []).map((detail) => ({ ...detail, schoolId: school.id })),
        };
      }).filter(Boolean);

      const savedEvents = eventPayload.length > 0 ? await dataService.bulkUpsertAcademicEvents(eventPayload) : [];
      for (const savedEvent of savedEvents) {
        const source = eventPayload.find((item) => item.id === savedEvent.id);
        if (supportsExamDetails) {
          await dataService.replaceAcademicEventExamDetails(savedEvent.id, source?.examDetails || []);
        }
      }

      toast.success(`데이터 업로드가 완료되었습니다. 일정 ${savedEvents.length}건을 반영했습니다.`);
      setCalendarWriteIssue(null);
    } catch (error) {
      setCalendarWriteIssue(error);
      toast.error(`학사 일정 데이터 업로드에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const dayDialogEvents = useMemo(
    () =>
      (dayEventMap.get(dayDialogDate) || []).map((event) => ({
        ...event,
        onOpen: () => {
          setDayDialogDate('');
          openExistingEvent(event);
        },
      })),
    [dayDialogDate, dayEventMap]
  );

  const desktopDayEvents = useMemo(
    () => (desktopDayPopover?.date ? dayEventMap.get(desktopDayPopover.date) || [] : []),
    [dayEventMap, desktopDayPopover]
  );

  const goToPrevMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const goToNextMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const goToCurrentMonth = () =>
    setCurrentDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const categorySegmentItems = SCHOOL_CATEGORY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: !schoolCatalog.some((school) => school.category === option.value),
    testId: `calendar-category-${option.value}`,
  }));

  const mobileViewModeItems = [
    { value: 'month', label: '월간 보기', testId: 'calendar-mobile-mode-month' },
    { value: 'agenda', label: '일정 목록', testId: 'calendar-mobile-mode-agenda' },
  ];

  const miniCalendarPanel = (
    <div className="academic-mini-calendar card-custom">
      <div className="academic-mini-calendar-header">
        <button type="button" className="academic-icon-button" onClick={goToPrevMonth}><ChevronLeft size={16} /></button>
        <strong>{monthLabel}</strong>
        <button type="button" className="academic-icon-button" onClick={goToNextMonth}><ChevronRight size={16} /></button>
      </div>
      <div className="academic-mini-weekdays">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="academic-mini-grid">
        {miniCalendarWeeks.flat().map((day) => {
          const dateString = formatDate(day);
          const inMonth = day.getMonth() === currentDate.getMonth();
          const isToday = dateString === todayString();
          return (
            <button key={dateString} type="button" className={`academic-mini-day ${!inMonth ? 'is-outside' : ''} ${isToday ? 'is-today' : ''}`} onClick={() => setCurrentDate(new Date(day.getFullYear(), day.getMonth(), 1))}>
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <div className="academic-mini-calendar-footer">
        <Button type="primary" style="weak" size="medium" className="academic-mini-calendar-today" onPress={goToCurrentMonth}>
          오늘로 이동
        </Button>
      </div>
    </div>
  );

  const filterPanelContent = (
    <div className="card-custom academic-sidebar-panel">
      <div className="academic-section-caption">필터</div>
      <div className="academic-sidebar-field academic-sidebar-field-stacked academic-sidebar-field-segmented">
        <span>학교 구분</span>
        <SegmentedControl
          value={selectedCategory === 'all' ? null : selectedCategory}
          onValueChange={(nextValue) =>
            setSelectedCategory((current) => (current === nextValue ? 'all' : nextValue))
          }
          items={categorySegmentItems}
          size="small"
          alignment="fixed"
          className="academic-filter-segmented"
        />
      </div>
      <div className="academic-sidebar-field academic-sidebar-field-stacked">
        <span>분류</span>
        <div className="academic-type-filter-wrap">
          {eventTypeOptions.map((type) => {
            const active = selectedTypes.includes(type.name);
            return (
              <button
                key={type.id}
                type="button"
                className={`academic-type-filter ${active ? 'is-active' : ''}`}
                style={{ '--type-color': type.color }}
                data-testid={`calendar-filter-type-${type.name}`}
                aria-pressed={active}
                onClick={() => setSelectedTypes((current) => current.includes(type.name) ? current.filter((value) => value !== type.name) : [...current, type.name])}
              >
                {type.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const sidebarContent = (
    <div className="academic-calendar-sidebar-content">
      {miniCalendarPanel}
      {filterPanelContent}
    </div>
  );

  const mobileFilterContent = (
    <div className="academic-calendar-mobile-sheet">
      <div className="card-custom academic-calendar-mobile-summary academic-calendar-mobile-summary-sheet">
        <div className="academic-calendar-mobile-summary-head">
          <div>
            <span className="academic-section-caption">빠른 요약</span>
            <strong>{monthLabel}</strong>
          </div>
          <span className="management-mobile-overview-badge">{monthEvents.length}개 일정</span>
        </div>
        <div className="academic-calendar-mobile-summary-copy">
          학교 구분과 분류만 빠르게 조정하고 월간 보기와 일정 목록을 오갈 수 있습니다.
        </div>
      </div>
      {filterPanelContent}
    </div>
  );

  const mobileWorkspaceToolbar = isMobile ? (
    <div className="card-custom academic-calendar-mobile-toolbar" data-testid="academic-calendar-mobile-toolbar">
      <div className="academic-calendar-mobile-toolbar-head">
        <div className="academic-calendar-mobile-month-copy">
          <strong>{monthLabel}</strong>
          <span>{selectedSchoolLabel} · {monthEvents.length}개 일정</span>
        </div>
        <div className="academic-toolbar-controls-mobile">
          <button type="button" className="action-chip" aria-label="이전 달" onClick={goToPrevMonth}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="action-chip" onClick={goToCurrentMonth}>
            오늘
          </button>
          <button type="button" className="action-chip" data-testid="calendar-top-rail-filter-button" onClick={() => setIsFilterSheetOpen(true)}>
            <Settings2 size={16} />
            필터
          </button>
          <button type="button" className="action-chip" aria-label="다음 달" onClick={goToNextMonth}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <SegmentedControl
        value={mobileViewMode}
        onValueChange={setMobileViewMode}
        items={mobileViewModeItems}
        size="small"
        alignment="fixed"
        className="academic-calendar-mobile-view-switch"
      />
    </div>
  ) : null;

  const workspaceTabItems = [
    { value: 'calendar', label: '캘린더', testId: 'academic-workspace-tab-calendar' },
    { value: 'school-annual-board', label: '학교 연간일정표', testId: 'academic-workspace-tab-school-board' },
  ];

  const openEmbeddedCalendarIntent = (intent) => {
    if (!intent) {
      return;
    }
    setActiveWorkspaceTab('calendar');
    setEmbeddedNavigationIntent({
      ...intent,
      nonce: intent.nonce || Date.now(),
    });
  };

  const openEmbeddedSchoolAnnualBoard = (intent) => {
    if (!intent) {
      return;
    }

    const matchedSchool =
      schoolByKey[intent.schoolKey] ||
      schoolCatalog.find((school) => school.id === intent.schoolId) ||
      schoolCatalog.find((school) => schoolKey(school.name) === schoolKey(intent.schoolName)) ||
      null;
    const schoolCategory =
      text(intent.schoolCategory) ||
      matchedSchool?.category ||
      (text(intent.grade) ? inferSchoolCategoryFromGrade(text(intent.grade)) : 'all');

    setActiveWorkspaceTab('school-annual-board');
    setEmbeddedNavigationIntent({
      ...intent,
      tab: 'school',
      subject: 'all-subjects',
      schoolCategory: schoolCategory || 'all',
      schoolId: '',
      schoolKey: '',
      schoolName: '',
      grade: '',
      periodCode: '',
      nonce: intent.nonce || Date.now(),
    });
  };

  return (
    <div className="view-container academic-calendar-app">
      <input ref={uploadRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(event) => uploadWorkbook(event.target.files?.[0])} />

      <AcademicEventModal
        open={Boolean(editingEvent)}
        draft={editingEvent}
        anchor={editingEventAnchor}
        schoolCatalog={schoolCatalog}
        typeDefinitions={eventTypeOptions}
        onClose={closeModal}
        onSave={saveEvent}
        onDelete={deleteEvent}
        onOpenRoadmap={openEmbeddedSchoolAnnualBoard}
        isSaving={isSaving}
        canEdit={canWriteCalendar}
        supportsExamDetails={supportsExamDetails}
      />

      <AcademicDayDialog open={Boolean(dayDialogDate)} title={dayDialogDate ? formatDisplayDateWithWeekday(dayDialogDate) : ''} events={dayDialogEvents} onClose={() => setDayDialogDate('')} typeColorMap={typeColorMap} />

      <DashboardFilterSheet
        open={isMobile && isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        onApply={() => setIsFilterSheetOpen(false)}
        title="캘린더 필터"
        subtitle="학교 구분과 분류 기준으로 일정을 좁혀 볼 수 있습니다."
        maxWidth={520}
        testId="calendar-filter-sheet"
      >
        {mobileFilterContent}
      </DashboardFilterSheet>

      <ConfirmDialog {...dialogProps} />

      {!isMobile && desktopEventPopover ? (
        <AcademicEventPopover
          event={desktopEventPopover.event}
          anchor={desktopEventPopover.anchor}
          typeColorMap={typeColorMap}
          canEdit={canWriteCalendar}
          onClose={closeDesktopPopovers}
          onEdit={() => openEventEditor(desktopEventPopover.event, desktopEventPopover.triggerAnchor)}
          onDelete={() => deleteEventByTarget(desktopEventPopover.event)}
          onOpenRoadmap={() => {
            closeDesktopPopovers();
            openEmbeddedSchoolAnnualBoard(buildRoadmapIntentFromEvent(desktopEventPopover.event));
          }}
        />
      ) : null}

      {!isMobile && desktopDayPopover ? (
        <AcademicDayPopover
          title={desktopDayPopover.title}
          events={desktopDayEvents}
          anchor={desktopDayPopover.anchor}
          typeColorMap={typeColorMap}
          onClose={closeDesktopPopovers}
          onOpenEvent={openExistingEvent}
        />
      ) : null}

      <section className="workspace-surface academic-calendar-workspace">
        {writeState ? <StatusBanner variant={writeState.tone === 'danger' ? 'error' : 'warning'} title={writeState.title} message={writeState.message} /> : null}
        <div className="academic-workspace-tabs" data-testid="academic-workspace-tabs">
          <Tab
            value={activeWorkspaceTab}
            onChange={setActiveWorkspaceTab}
            items={workspaceTabItems}
            size={isMobile ? 'small' : 'large'}
            fluid={isMobile}
            className="academic-workspace-tab-control"
          />
        </div>
        {activeWorkspaceTab === 'calendar' ? mobileWorkspaceToolbar : null}

        {activeWorkspaceTab === 'calendar' ? (
          <div className="academic-calendar-shell">
            {!isMobile ? <aside className="academic-calendar-sidebar">{sidebarContent}</aside> : null}
            <main ref={calendarMainRef} className="academic-calendar-main" onWheel={handleCalendarWheel}>
              {inlineComposerDraft && inlineComposerAnchor ? (
                <AcademicInlineComposer
                  draft={inlineComposerDraft}
                  anchor={inlineComposerAnchor}
                  composerRef={inlineComposerRef}
                  schoolCatalog={schoolCatalog}
                  typeDefinitions={eventTypeOptions}
                  onChange={updateInlineComposerDraft}
                  onClose={closeInlineComposer}
                  onSave={(draft) => saveEvent(draft, { source: 'inline' })}
                  onOpenRoadmap={openEmbeddedSchoolAnnualBoard}
                  isSaving={isSaving}
                  supportsExamDetails={supportsExamDetails}
                />
              ) : null}
              {!isMobile || mobileViewMode === 'month' ? (
                <div data-testid="calendar-month-grid">
                  <AcademicMonthGridV2 currentDate={currentDate} weeks={monthWeeks} weekCount={monthWeeks.length} monthEvents={monthEvents} dayEventMap={dayEventMap} typeColorMap={typeColorMap} selectionAnchor={selectionAnchor} selectionRange={selectionRange} setSelectionAnchor={setSelectionAnchor} setSelectionRange={setSelectionRange} canWriteCalendar={canWriteCalendar} draggedEventId={draggedEventId} setDraggedEventId={setDraggedEventId} onOpenDay={openDayEvents} onOpenEvent={openExistingEvent} onCreateRange={openCreateComposer} onMoveEvent={moveEvent} visibleLaneCount={isMobile ? 1 : 3} dayButtonRefs={dayButtonRefs} />
                </div>
              ) : null}
              {isMobile && mobileViewMode === 'agenda' ? (
                <AcademicAgendaList
                  groups={agendaGroups}
                  onOpenEvent={openExistingEvent}
                  typeColorMap={typeColorMap}
                />
              ) : null}
            </main>
          </div>
        ) : (
          <CurriculumRoadmapView
            data={data}
            dataService={dataService}
            navigationIntent={embeddedNavigationIntent}
            onOpenAcademicCalendar={openEmbeddedCalendarIntent}
            embeddedMode="school-annual-board"
          />
        )}
      </section>
    </div>
  );
}




  const eventTypeOptions = DEFAULT_EVENT_TYPE_DEFINITIONS;
