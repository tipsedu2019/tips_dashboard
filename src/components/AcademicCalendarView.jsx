import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  List,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { dataService as sharedDataService } from '../services/dataService';
import { useToast } from '../contexts/ToastContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import ConfirmDialog from './ui/ConfirmDialog';
import BottomSheet from './ui/BottomSheet';
import StatusBanner from './ui/StatusBanner';
import { useAuth } from '../contexts/AuthContext';
import { useDeferredValue } from 'react';
import { getAcademicCalendarWriteState, getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { detectAcademicWorkbookFormat, parseHighSchoolMatrixWorkbook } from '../lib/academicWorkbookUtils';
import useViewport from '../hooks/useViewport';

const EVENT_TYPE_COLOR_PALETTE = ['#2b6c5c', '#b67a3c', '#597b97', '#7b6c98', '#6a8456', '#a55f57', '#7d6553'];
const DEFAULT_EVENT_COLOR = EVENT_TYPE_COLOR_PALETTE[0];
const DEFAULT_EVENT_TYPE_DEFINITIONS = [
  { id: 'exam', name: '\uC2DC\uD5D8', color: EVENT_TYPE_COLOR_PALETTE[0] },
  { id: 'field-trip', name: '\uCCB4\uD5D8\uD559\uC2B5', color: EVENT_TYPE_COLOR_PALETTE[2] },
  { id: 'vacation', name: '\uBC29\uD559', color: EVENT_TYPE_COLOR_PALETTE[1] },
  { id: 'misc', name: '\uAE30\uD0C0\uC77C\uC815', color: EVENT_TYPE_COLOR_PALETTE[6] },
  { id: 'academy', name: '\uD559\uC6D0\uD589\uC0AC', color: EVENT_TYPE_COLOR_PALETTE[3] },
  { id: 'holiday', name: '\uC815\uAE30\uD734\uAC15', color: EVENT_TYPE_COLOR_PALETTE[5] },
];
const DEFAULT_EVENT_TYPES = DEFAULT_EVENT_TYPE_DEFINITIONS.map((item) => item.name);
const DEFAULT_EVENT_TYPE_IDS = Object.fromEntries(DEFAULT_EVENT_TYPE_DEFINITIONS.map((item) => [item.name, item.id]));
const SUBJECT_OPTIONS = ['\uC601\uC5B4', '\uC218\uD559'];
const GRADE_ORDER = ['\uCD086', '\uC9111', '\uC9112', '\uC9113', '\uACE01', '\uACE02', '\uACE03'];
const EVENT_TYPE_STORAGE_KEY = 'tips-academic-event-types-v2';
const EVENT_VIEW_STORAGE_KEY = 'tips-academic-view-v3';
const NOTE_META_MARKER = '[[TIPS_META]]';
const NON_REMOVABLE_EVENT_TYPE_IDS = new Set(['exam', 'vacation']);
const CATEGORY_OPTIONS = [
  { value: 'all', label: '\uC804\uCCB4 \uAD6C\uBD84' },
  { value: 'elementary', label: '\uCD08\uB4F1' },
  { value: 'middle', label: '\uC911\uB4F1' },
  { value: 'high', label: '\uACE0\uB4F1' },
];
const WEEKDAY_LABELS = ['\uC77C', '\uC6D4', '\uD654', '\uC218', '\uBAA9', '\uAE08', '\uD1A0'];

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function text(value) {
  return String(value || '').trim();
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

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label || '\uAE30\uD0C0';
}

function normalizeEventTypeDefinitions(raw) {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_EVENT_TYPE_DEFINITIONS;
  return source
    .map((entry, index) => {
      const defaultEntry = DEFAULT_EVENT_TYPE_DEFINITIONS.find((item) =>
        item.name === (typeof entry === 'string' ? text(entry) : text(entry?.name)) || item.id === text(entry?.id)
      );
      if (typeof entry === 'string') {
        return {
          id: defaultEntry?.id || `${entry}-${index}`,
          name: text(entry),
          color: defaultEntry?.color || pickEventTypeColor(entry, index),
        };
      }
      return {
        id: text(entry.id) || `${text(entry.name) || 'type'}-${index}`,
        name: text(entry.name),
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
  grades.slice(0, 2).forEach((grade) => {
    tokens.push({ key: `grade-${grade}`, label: grade, tone: 'grade' });
  });
  if (grades.length > 2) {
    tokens.push({ key: `grade-more-${event.id || event.title}`, label: `+${grades.length - 2}`, tone: 'grade' });
  }
  return tokens;
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

function inferCategory(grade) {
  if (String(grade).startsWith('초')) return 'elementary';
  if (String(grade).startsWith('중')) return 'middle';
  return 'high';
}

function getGradeSortValue(grade) {
  const label = text(grade);
  const directIndex = GRADE_ORDER.indexOf(label);
  if (directIndex >= 0) {
    return directIndex;
  }
  if (label.startsWith('초')) return 0;
  if (label.startsWith('중')) return 100;
  if (label.startsWith('고')) return 200;
  return 999;
}

function normalizeType(value) {
  const next = text(value);
  if (next.includes('\uC2DC\uD5D8')) return '\uC2DC\uD5D8';
  if (next.includes('\uCCB4\uD5D8') || next.includes('\uD559\uC2B5')) return '\uCCB4\uD5D8\uD559\uC2B5';
  if (next.includes('\uBC29\uD559') || next.includes('\uAC1C\uD559')) return '\uBC29\uD559';
  if (next.includes('\uD589\uC0AC')) return '\uD559\uC6D0\uD589\uC0AC';
  if (next.includes('\uD734\uAC15')) return '\uC815\uAE30\uD734\uAC15';
  return next || '\uAE30\uD0C0\uC77C\uC815';
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

function buildStudentSchoolCatalog(students = [], academicSchools = []) {
  const matchedSchools = new Map((academicSchools || []).map((school) => [schoolKey(school.name), school]));
  const buckets = new Map();

  (students || []).forEach((student) => {
    const schoolName = text(student.school);
    if (!schoolName) return;
    const key = schoolKey(schoolName);
    if (!buckets.has(key)) {
      const matched = matchedSchools.get(key);
      buckets.set(key, {
        id: matched?.id || '',
        name: schoolName,
        color: matched?.color || DEFAULT_EVENT_COLOR,
        category: matched?.category || inferCategory(student.grade),
        grades: new Set(),
      });
    }
    if (student.grade) buckets.get(key).grades.add(text(student.grade));
  });

  return [...buckets.values()]
    .map((school) => ({
      ...school,
      grades: [...school.grades].sort(
        (left, right) => getGradeSortValue(left) - getGradeSortValue(right) || left.localeCompare(right, 'ko')
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function buildMonthWeeks(currentDate) {
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
  return visibleLanes * 28 + Math.max(0, visibleLanes - 1) * 6 + 8;
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
    type: '시험',
    category: school?.category || 'all',
    grade: '',
    grades: [],
    start: dateString || todayString(),
    end: dateString || todayString(),
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
      { key: 'school-sub-group', label: '학교 부교재', items: schoolSupplements },
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
            <strong>색상은 자동으로 맞추고, 분류 이름과 순서만 관리합니다.</strong>
          </div>
          <p>시험, 방학 같은 핵심 분류는 고정하고 나머지는 자유롭게 추가하거나 정리할 수 있습니다.</p>
        </div>

        <div className="academic-type-manager-add">
          <div className="academic-type-manager-add-field">
            <span className="academic-section-caption">새 분류</span>
            <input
              className="styled-input"
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="예: 설명회, 모의고사"
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
                <button type="button" className="action-chip" onClick={() => setDraftDefinitions((current) => moveArrayItem(current, index, -1))} disabled={index === 0}><ArrowUp size={14} /></button>
                <button type="button" className="action-chip" onClick={() => setDraftDefinitions((current) => moveArrayItem(current, index, 1))} disabled={index === draftDefinitions.length - 1}><ArrowDown size={14} /></button>
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

function GradeMultiSelect({ options, selectedValues, onChange, disabled, clearLabel = '전체 학년' }) {
  const normalizedSelected = [...new Set((selectedValues || []).map((item) => text(item)).filter(Boolean))];
  const normalizedOptions = [...new Set((options || []).map((item) => text(item)).filter(Boolean))];

  return (
    <div className="academic-chip-selector">
      <button
        type="button"
        className={`academic-chip-option ${normalizedSelected.length === 0 ? 'is-active' : ''}`}
        onClick={() => onChange([])}
        disabled={disabled}
      >
        {clearLabel}
      </button>
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

function AcademicEventModal({
  open,
  draft,
  schoolCatalog,
  typeDefinitions,
  curriculumData,
  onClose,
  onSave,
  onDelete,
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

  const visibleSchools =
    localDraft.category === 'all'
      ? schoolCatalog
      : schoolCatalog.filter((school) => school.category === localDraft.category);
  const selectedSchool = schoolCatalog.find((school) => schoolKey(school.name) === localDraft.schoolKey) || null;
  const selectedType = typeDefinitions.find((item) => item.name === localDraft.type) || typeDefinitions[0] || null;
  const modalGradeOptions = selectedSchool?.grades?.length ? selectedSchool.grades : GRADE_ORDER;

  const updateDraft = (patch) => {
    setLocalDraft((current) => ({ ...current, ...patch }));
  };

  const setDraftGrades = (nextGrades) => {
    const normalized = [...new Set((nextGrades || []).map((item) => text(item)).filter(Boolean))];
    updateDraft({
      grades: normalized,
      grade: joinGradeTokens(normalized),
    });
  };

  const applySchool = (nextSchoolKey) => {
    if (!nextSchoolKey) {
      updateDraft({
        schoolKey: '',
        schoolId: '',
        school: '',
      });
      return;
    }
    const nextSchool = schoolCatalog.find((school) => schoolKey(school.name) === nextSchoolKey) || null;
    if (!nextSchool) return;
    const nextGrades = (localDraft.grades || []).filter((grade) => nextSchool.grades.includes(grade));
    updateDraft({
      schoolKey: nextSchoolKey,
      schoolId: nextSchool.id || '',
      school: nextSchool.name,
      color: nextSchool.color || localDraft.color,
      category: nextSchool.category || localDraft.category,
      grades: nextGrades,
      grade: joinGradeTokens(nextGrades),
    });
  };

  const changeCategory = (nextCategory) => {
    const currentSchool =
      schoolCatalog.find((school) => schoolKey(school.name) === localDraft.schoolKey && school.category === nextCategory) || null;
    updateDraft({
      category: nextCategory,
      schoolKey: currentSchool ? schoolKey(currentSchool.name) : '',
      schoolId: currentSchool?.id || '',
      school: currentSchool?.name || '',
      color: currentSchool?.color || localDraft.color,
    });
  };

  const updateExamDetail = (detailId, patch) => {
    updateDraft({
      examDetails: (localDraft.examDetails || []).map((detail) =>
        detail.id === detailId
          ? {
              ...detail,
              ...patch,
            }
          : detail
      ),
    });
  };

  const modalActions = (
    <div className="academic-modal-actions">
      <div>
        {localDraft.id && canEdit ? (
          <button type="button" className="action-chip" onClick={onDelete}>
            <Trash2 size={16} />
            일정 삭제
          </button>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="action-chip" onClick={onClose}>
          닫기
        </button>
        {canEdit ? (
          <button type="button" className="action-pill" onClick={() => onSave(localDraft)} disabled={isSaving}>
            <Save size={16} />
            {isSaving ? '저장 중...' : '일정 저장'}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={localDraft.id ? '학사 일정 편집' : '학사 일정 추가'}
      subtitle="기본 정보와 시험 세부사항을 한 번에 빠르게 정리할 수 있습니다."
      maxWidth={isMobile ? 700 : 620}
      fullHeightOnMobile
      actions={modalActions}
    >
      <div className="academic-event-modal">
        <section className="academic-modal-section">
          <div className="academic-modal-section-header">
            <div>
              <div className="academic-section-caption">기본 정보</div>
              <h3>일정 이름과 분류</h3>
            </div>
            {selectedType ? (
              <span className="academic-type-badge" style={{ background: `${selectedType.color}1A`, color: selectedType.color }}>
                {selectedType.name}
              </span>
            ) : null}
          </div>
          <div className="academic-modal-grid academic-modal-grid-2">
            <label className="academic-field">
              <span>제목</span>
              <input className="styled-input" value={localDraft.title} onChange={(event) => updateDraft({ title: event.target.value })} disabled={!canEdit} />
            </label>
            <label className="academic-field">
              <span>분류</span>
              <select className="styled-input" value={localDraft.type} onChange={(event) => updateDraft({ type: event.target.value })} disabled={!canEdit}>
                {typeDefinitions.map((type) => (
                  <option key={type.id} value={type.name}>{type.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="academic-modal-section">
          <div className="academic-modal-section-header">
            <div>
              <div className="academic-section-caption">대상 정보</div>
              <h3>구분, 학교, 학년</h3>
            </div>
          </div>
          <div className="academic-modal-grid academic-modal-grid-3">
            <label className="academic-field">
              <span>구분</span>
              <select className="styled-input" value={localDraft.category} onChange={(event) => changeCategory(event.target.value)} disabled={!canEdit}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="academic-field">
              <span>학교</span>
              <select className="styled-input" value={localDraft.schoolKey} onChange={(event) => applySchool(event.target.value)} disabled={!canEdit}>
                <option value="">학교 없음</option>
                {visibleSchools.map((school) => (
                  <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
                ))}
              </select>
            </label>
            <div className="academic-field">
              <span>학년</span>
              <GradeMultiSelect
                options={modalGradeOptions}
                selectedValues={localDraft.grades || []}
                onChange={setDraftGrades}
                disabled={!canEdit}
                clearLabel="전체 학년"
              />
            </div>
          </div>
        </section>

        <section className="academic-modal-section">
          <div className="academic-modal-section-header">
            <div>
              <div className="academic-section-caption">일정 정보</div>
              <h3>기간과 메모</h3>
            </div>
          </div>
          <div className="academic-modal-grid academic-modal-grid-2">
            <label className="academic-field">
              <span>시작일</span>
              <input className="styled-input" type="date" value={localDraft.start} onChange={(event) => updateDraft({ ...clampDateRange(event.target.value, localDraft.end) })} disabled={!canEdit} />
            </label>
            <label className="academic-field">
              <span>종료일</span>
              <input className="styled-input" type="date" value={localDraft.end} onChange={(event) => updateDraft({ ...clampDateRange(localDraft.start, event.target.value) })} disabled={!canEdit} />
            </label>
          </div>
          <label className="academic-field">
            <span>메모</span>
            <textarea className="styled-input" value={localDraft.note} onChange={(event) => updateDraft({ note: event.target.value })} disabled={!canEdit} style={{ minHeight: 96, resize: 'vertical' }} />
          </label>
        </section>

        {localDraft.type === '시험' ? (
          <section className="academic-modal-section">
            <div className="academic-modal-section-header">
              <div>
                <div className="academic-section-caption">시험 세부사항</div>
                <h3>과목별 시험일과 범위</h3>
                <p>학교, 학년, 과목, 시험일과 시험범위를 같은 일정 안에서 함께 관리합니다. 시험 날짜가 아직 정해지지 않았다면 미정 상태로 남길 수 있습니다.</p>
              </div>
              {canEdit && supportsExamDetails ? (
                <button
                  type="button"
                  className="action-pill"
                  onClick={() =>
                    updateDraft({
                      examDetails: [
                        ...(localDraft.examDetails || []),
                        {
                          id: createId(),
                          schoolKey: localDraft.schoolKey,
                          schoolId: localDraft.schoolId,
                          grade: localDraft.grade,
                          subject: SUBJECT_OPTIONS[0],
                          examDateStatus: 'tbd',
                          examDate: '',
                          textbookScope: '',
                          supplementScope: '',
                          otherScope: '',
                          note: '',
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  세부사항 추가
                </button>
              ) : null}
            </div>

            {!supportsExamDetails ? (
              <div className="academic-muted-helper">시험 세부사항 저장은 현재 DB 확장 설정 후 사용할 수 있습니다. 기본 일정 자체는 정상 저장됩니다.</div>
            ) : (localDraft.examDetails || []).length === 0 ? (
              <div className="academic-empty-inline">아직 등록된 시험 세부사항이 없습니다.</div>
            ) : (
              <div className="academic-exam-detail-list">
                {(localDraft.examDetails || []).map((detail) => {
                  const detailSchool = schoolCatalog.find((school) => schoolKey(school.name) === detail.schoolKey) || selectedSchool;
                  const quickInsertOptions = buildExamQuickInsertOptions(detail, localDraft, schoolCatalog, curriculumData);
                  return (
                    <div key={detail.id} className="academic-exam-detail-card">
                      <div className="academic-modal-grid academic-modal-grid-4">
                        <label className="academic-field">
                          <span>학교</span>
                          <select className="styled-input" value={detail.schoolKey} onChange={(event) => {
                            const nextSchool = schoolCatalog.find((school) => schoolKey(school.name) === event.target.value) || null;
                            updateExamDetail(detail.id, {
                              schoolKey: event.target.value,
                              schoolId: nextSchool?.id || '',
                              grade: nextSchool?.grades?.[0] || detail.grade,
                            });
                          }} disabled={!canEdit}>
                            {schoolCatalog.map((school) => (
                              <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="academic-field">
                          <span>학년</span>
                          <select className="styled-input" value={detail.grade} onChange={(event) => updateExamDetail(detail.id, { grade: event.target.value })} disabled={!canEdit}>
                            {(detailSchool?.grades?.length ? detailSchool.grades : GRADE_ORDER).map((grade) => (
                              <option key={grade} value={grade}>{grade}</option>
                            ))}
                          </select>
                        </label>
                        <label className="academic-field">
                          <span>과목</span>
                          <select className="styled-input" value={detail.subject} onChange={(event) => updateExamDetail(detail.id, { subject: event.target.value })} disabled={!canEdit}>
                            {SUBJECT_OPTIONS.map((subject) => (
                              <option key={subject} value={subject}>{subject}</option>
                            ))}
                          </select>
                        </label>
                        <label className="academic-field">
                          <span>시험일 상태</span>
                          <select className="styled-input" value={detail.examDateStatus || 'exact'} onChange={(event) => updateExamDetail(detail.id, { examDateStatus: event.target.value, examDate: event.target.value === 'tbd' ? '' : detail.examDate })} disabled={!canEdit}>
                            <option value="exact">정확한 날짜</option>
                            <option value="tbd">미정</option>
                          </select>
                        </label>
                      </div>

                      <div className="academic-modal-grid academic-modal-grid-2">
                        <label className="academic-field">
                          <span>시험일</span>
                          <input className="styled-input" type="date" value={detail.examDate || ''} onChange={(event) => updateExamDetail(detail.id, { examDate: event.target.value, examDateStatus: event.target.value ? 'exact' : detail.examDateStatus || 'exact' })} disabled={!canEdit || detail.examDateStatus === 'tbd'} />
                        </label>
                        <div className="academic-field">
                          <span>상태 안내</span>
                          <div className="academic-inline-state">
                            {detail.examDateStatus === 'tbd' ? '시험일 미정' : detail.examDate ? formatDisplayDateWithWeekday(detail.examDate) : '시험일을 입력해 주세요.'}
                          </div>
                        </div>
                      </div>

                      <label className="academic-field">
                        <span>교과서 범위</span>
                        <textarea className="styled-input" value={detail.textbookScope} placeholder="교과서 범위를 입력해 주세요." onChange={(event) => updateExamDetail(detail.id, { textbookScope: event.target.value })} disabled={!canEdit} style={{ minHeight: 78, resize: 'vertical' }} />
                      </label>
                      <QuickInsertChips title="교과서 빠른 삽입" groups={quickInsertOptions.textbookScope} disabled={!canEdit} onSelect={(value) => updateExamDetail(detail.id, { textbookScope: appendScopeValue(detail.textbookScope, value) })} />

                      <label className="academic-field">
                        <span>부교재 범위</span>
                        <textarea className="styled-input" value={detail.supplementScope} placeholder="부교재 또는 보조 교재 범위를 입력해 주세요." onChange={(event) => updateExamDetail(detail.id, { supplementScope: event.target.value })} disabled={!canEdit} style={{ minHeight: 78, resize: 'vertical' }} />
                      </label>
                      <QuickInsertChips title="부교재 빠른 삽입" groups={quickInsertOptions.supplementScope} disabled={!canEdit} onSelect={(value) => updateExamDetail(detail.id, { supplementScope: appendScopeValue(detail.supplementScope, value) })} />

                      <div className="academic-modal-grid academic-modal-grid-2">
                        <label className="academic-field">
                          <span>기타 범위</span>
                          <textarea className="styled-input" value={detail.otherScope} placeholder="기타 범위를 입력해 주세요." onChange={(event) => updateExamDetail(detail.id, { otherScope: event.target.value })} disabled={!canEdit} style={{ minHeight: 78, resize: 'vertical' }} />
                        </label>
                        <label className="academic-field">
                          <span>비고</span>
                          <textarea className="styled-input" value={detail.note} placeholder="메모" onChange={(event) => updateExamDetail(detail.id, { note: event.target.value })} disabled={!canEdit} style={{ minHeight: 78, resize: 'vertical' }} />
                        </label>
                      </div>

                      {canEdit ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="button" className="action-chip" onClick={() => updateDraft({ examDetails: (localDraft.examDetails || []).filter((item) => item.id !== detail.id) })}>
                            <Trash2 size={14} />
                            세부사항 삭제
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>
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
  isSaving,
  supportsExamDetails,
}) {
  if (!draft || !anchor) {
    return null;
  }

  const visibleSchools =
    draft.category === 'all'
      ? schoolCatalog
      : schoolCatalog.filter((school) => school.category === draft.category);
  const selectedSchool = schoolCatalog.find((school) => schoolKey(school.name) === draft.schoolKey) || null;
  const selectedType = typeDefinitions.find((item) => item.name === draft.type) || typeDefinitions[0] || null;
  const gradeOptions = selectedSchool?.grades?.length ? selectedSchool.grades : GRADE_ORDER;

  const setDraftGrades = (nextGrades) => {
    const normalized = [...new Set((nextGrades || []).map((item) => text(item)).filter(Boolean))];
    onChange({
      grades: normalized,
      grade: joinGradeTokens(normalized),
    });
  };

  const changeCategory = (nextCategory) => {
    const currentSchool =
      schoolCatalog.find((school) => schoolKey(school.name) === draft.schoolKey && school.category === nextCategory) || null;
    onChange({
      category: nextCategory,
      schoolKey: currentSchool ? schoolKey(currentSchool.name) : '',
      schoolId: currentSchool?.id || '',
      school: currentSchool?.name || '',
      color: currentSchool?.color || draft.color,
    });
  };

  const applySchool = (nextSchoolKey) => {
    if (!nextSchoolKey) {
      onChange({
        schoolKey: '',
        schoolId: '',
        school: '',
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

  return (
    <section
      ref={composerRef}
      className="academic-inline-composer"
      style={{
        top: anchor.top,
        left: anchor.left,
        width: anchor.width,
        '--composer-color': selectedType?.color || getEventColor(draft, Object.fromEntries(typeDefinitions.map((item) => [item.name, item.color]))),
      }}
    >
      <div className="academic-inline-composer-head">
        <div>
          <div className="academic-section-caption">빠른 일정 추가</div>
          <strong>{anchor.label}</strong>
          <p>{draft.start === draft.end ? '선택한 날짜에 바로 추가합니다.' : `${formatDisplayDate(draft.start)} - ${formatDisplayDate(draft.end)} 범위로 추가합니다.`}</p>
        </div>
        <button type="button" className="academic-icon-button" onClick={onClose} aria-label="빠른 입력 닫기">
          <X size={16} />
        </button>
      </div>

      <div className="academic-inline-composer-grid">
        <label className="academic-field">
          <span>제목</span>
          <input
            className="styled-input"
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="일정 이름을 입력해 주세요."
            autoFocus
          />
        </label>
        <label className="academic-field">
          <span>분류</span>
          <select className="styled-input" value={draft.type} onChange={(event) => onChange({ type: event.target.value })}>
            {typeDefinitions.map((type) => (
              <option key={type.id} value={type.name}>{type.name}</option>
            ))}
          </select>
        </label>
        <label className="academic-field">
          <span>구분</span>
          <select className="styled-input" value={draft.category} onChange={(event) => changeCategory(event.target.value)}>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="academic-field">
          <span>학교</span>
          <select className="styled-input" value={draft.schoolKey} onChange={(event) => applySchool(event.target.value)}>
            <option value="">학교 없음</option>
            {visibleSchools.map((school) => (
              <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
            ))}
          </select>
        </label>
        <label className="academic-field">
          <span>시작일</span>
          <input
            className="styled-input"
            type="date"
            value={draft.start}
            onChange={(event) => onChange({ ...clampDateRange(event.target.value, draft.end) })}
          />
        </label>
        <label className="academic-field">
          <span>종료일</span>
          <input
            className="styled-input"
            type="date"
            value={draft.end}
            onChange={(event) => onChange({ ...clampDateRange(draft.start, event.target.value) })}
          />
        </label>
      </div>

      <div className="academic-field">
        <span>학년</span>
        <GradeMultiSelect
          options={gradeOptions}
          selectedValues={draft.grades || []}
          onChange={setDraftGrades}
          clearLabel="전체 학년"
        />
      </div>

      <label className="academic-field">
        <span>메모</span>
        <textarea
          className="styled-input"
          value={draft.note}
          onChange={(event) => onChange({ note: event.target.value })}
          placeholder="필요한 메모가 있다면 간단히 남겨 주세요."
          style={{ minHeight: 88, resize: 'vertical' }}
        />
      </label>

      {draft.type === '시험' && supportsExamDetails ? (
        <div className="academic-inline-composer-helper">
          시험 범위와 세부 정보는 저장 후 해당 일정을 눌러 이어서 입력할 수 있습니다.
        </div>
      ) : null}

      <div className="academic-inline-composer-actions">
        <button type="button" className="action-chip" onClick={onClose}>
          취소
        </button>
        <button type="button" className="action-pill" onClick={() => onSave(draft)} disabled={isSaving}>
          <Save size={16} />
          {isSaving ? '저장 중...' : '일정 저장'}
        </button>
      </div>
    </section>
  );
}

function AcademicDayDialog({ open, title, events, onClose, typeColorMap }) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle="선택한 날짜의 일정을 빠르게 훑고 바로 열어볼 수 있습니다."
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

function AcademicMonthGridV2({
  currentDate,
  weeks,
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

      <div className="academic-month-weeks">
        {weeks.map((week) => {
          const { segments, laneCount } = buildWeekSegments(week, monthEvents);
          const hiddenCounts = buildHiddenSegmentCounts(week, segments, visibleLaneCount);
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
                      <button
                        key={dateString}
                        ref={(node) => {
                          if (node) {
                            dayButtonRefs.current.set(dateString, node);
                          } else {
                            dayButtonRefs.current.delete(dateString);
                          }
                        }}
                        type="button"
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
                        onMouseUp={() => {
                          if (!selectionAnchor || !selectionRange) return;
                          onCreateRange(selectionRange.start, selectionRange.end, dateString);
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
                              onOpenDay(dateString);
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
                              onOpenDay(dateString);
                            }}
                          >
                            +{hiddenCounts[dateString]} 더보기                          </button>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {visibleLanes > 0 ? (
                  <div className="academic-week-lanes">
                    {Array.from({ length: visibleLanes }).map((_, laneIndex) => (
                      <div key={`lane-${laneIndex}`} className="academic-event-lane">
                        {segments.filter((segment) => segment.laneIndex === laneIndex).map((segment) => {
                          const metaSummary = formatEventMetaSummary(segment.event, { includeType: false });

                          return (
                            <button
                              key={`${segment.event.id}-${laneIndex}`}
                              type="button"
                              draggable={canWriteCalendar}
                              onDragStart={() => setDraggedEventId(segment.event.id)}
                              onDragEnd={() => setDraggedEventId('')}
                              onClick={() => onOpenEvent(segment.event)}
                              className="academic-event-bar"
                              style={{
                                gridColumn: `${segment.startIndex + 1} / ${segment.endIndex + 2}`,
                                '--event-color': getEventColor(segment.event, typeColorMap),
                              }}
                              aria-label={[segment.event.title, formatEventMetaSummary(segment.event, { includeType: false })].filter(Boolean).join(', ')}
                            >
                              <span className="academic-event-bar-edge">{segment.isStartClipped ? '‹' : ''}</span>
                              <span className="academic-event-bar-content">
                                <span className="academic-event-bar-title">{segment.event.title}</span>
                                {metaSummary ? <span className="academic-event-bar-meta">{metaSummary}</span> : null}
                              </span>
                              <span className="academic-event-bar-edge">{segment.isEndClipped ? '›' : ''}</span>
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
    <div className="academic-agenda-list">
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

export default function AcademicCalendarView({ data, dataService = sharedDataService }) {
  const toast = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const { isStaff } = useAuth();
  const { isMobile } = useViewport();
  const uploadRef = useRef(null);
  const searchInputRef = useRef(null);
  const dayButtonRefs = useRef(new Map());
  const calendarMainRef = useRef(null);
  const inlineComposerRef = useRef(null);

  const canWriteCalendar = isStaff;
  const canUpload = isStaff;

  const [currentDate, setCurrentDate] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [currentView, setCurrentView] = useState(() => {
    const saved = readLocalStorageJson(EVENT_VIEW_STORAGE_KEY, 'month');
    return saved === 'agenda' ? 'agenda' : 'month';
  });
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSchoolKey, setSelectedSchoolKey] = useState('all');
  const [selectedGrades, setSelectedGrades] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState(DEFAULT_EVENT_TYPES);
  const [eventTypeOptions, setEventTypeOptions] = useState(() =>
    normalizeEventTypeDefinitions(readLocalStorageJson(EVENT_TYPE_STORAGE_KEY, DEFAULT_EVENT_TYPE_DEFINITIONS))
  );
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [editingEvent, setEditingEvent] = useState(null);
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
  const [isTypeManagerOpen, setIsTypeManagerOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [dayDialogDate, setDayDialogDate] = useState('');
  const [inlineComposerDraft, setInlineComposerDraft] = useState(null);
  const [inlineComposerAnchor, setInlineComposerAnchor] = useState(null);

  const closeInlineComposer = () => {
    setInlineComposerDraft(null);
    setInlineComposerAnchor(null);
  };

  const schoolCatalog = useMemo(
    () => buildStudentSchoolCatalog(data.students, data.academicSchools),
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
    let cancelled = false;
    dataService
      .getAppPreference('academic-calendar:event-types')
      .then((preference) => {
        if (cancelled || !preference?.value) return;
        const next = normalizeEventTypeDefinitions(preference.value);
        setEventTypeOptions(next);
        setSelectedTypes((current) => {
          const allowed = new Set(next.map((item) => item.name));
          const normalized = current.filter((item) => allowed.has(item));
          return normalized.length > 0 ? normalized : next.map((item) => item.name);
        });
      })
      .catch(() => {
        // Server preference is optional.
      });
    return () => {
      cancelled = true;
    };
  }, [dataService]);

  useEffect(() => {
    persistLocalStorageJson(EVENT_VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  useEffect(() => {
    persistLocalStorageJson(EVENT_TYPE_STORAGE_KEY, eventTypeOptions);
  }, [eventTypeOptions]);

  useEffect(() => {
    setSelectedTypes((current) => {
      const allowed = new Set(eventTypeOptions.map((item) => item.name));
      const normalized = current.filter((item) => allowed.has(item));
      return normalized.length > 0 ? normalized : eventTypeOptions.map((item) => item.name);
    });
  }, [eventTypeOptions]);

  useEffect(() => {
    const handler = (event) => {
      if (event.defaultPrevented) return;
      const activeTag = document.activeElement?.tagName;
      if (event.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === 't') {
        event.preventDefault();
        setCurrentDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      }
      if (event.key === 'm') {
        event.preventDefault();
        setCurrentView('month');
      }
      if (event.key === 'a') {
        event.preventDefault();
        setCurrentView('agenda');
      }
      if (event.key === 'Escape') {
        setDayDialogDate('');
        setIsFilterSheetOpen(false);
        setIsTypeManagerOpen(false);
        closeInlineComposer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (currentView !== 'month' || isMobile) {
      closeInlineComposer();
    }
  }, [currentView, currentDate, isMobile]);

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

  const visibleSchools = useMemo(
    () => (selectedCategory === 'all' ? schoolCatalog : schoolCatalog.filter((school) => school.category === selectedCategory)),
    [schoolCatalog, selectedCategory]
  );
  const visibleSchoolKeys = useMemo(
    () => new Set(visibleSchools.map((school) => schoolKey(school.name))),
    [visibleSchools]
  );
  const gradeOptions = useMemo(() => {
    if (selectedSchoolKey === 'all') {
      const values = new Set();
      visibleSchools.forEach((school) => school.grades.forEach((grade) => values.add(grade)));
      return ['all', ...[...values].sort((left, right) => getGradeSortValue(left) - getGradeSortValue(right) || left.localeCompare(right, 'ko'))];
    }
    return ['all', ...(schoolByKey[selectedSchoolKey]?.grades || [])];
  }, [schoolByKey, selectedSchoolKey, visibleSchools]);

  useEffect(() => {
    if (selectedSchoolKey !== 'all' && !visibleSchoolKeys.has(selectedSchoolKey)) {
      setSelectedSchoolKey('all');
    }
  }, [selectedSchoolKey, visibleSchoolKeys]);

  useEffect(() => {
    setSelectedGrades((current) => current.filter((grade) => grade !== 'all' && gradeOptions.includes(grade)));
  }, [gradeOptions]);

  const typeColorMap = useMemo(
    () => Object.fromEntries(eventTypeOptions.map((item) => [item.name, item.color])),
    [eventTypeOptions]
  );

  const events = useMemo(
    () =>
      (data.academicEvents || []).map((event) => {
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
          category: school?.category || (event.grade && event.grade !== 'all' ? inferCategory(event.grade) : 'all'),
          color: event.color || school?.color || DEFAULT_EVENT_COLOR,
          note: noteText,
          tags: normalizeTags(meta.tags || []),
          examDetails: (examDetailsByEvent[event.id] || []).map((detail) => ({
            ...detail,
            schoolKey: schoolKey(schoolCatalog.find((row) => row.id === detail.schoolId)?.name || event.school),
            examDateStatus: detail.examDateStatus || detail.exam_date_status || (detail.examDate ? 'exact' : 'tbd'),
          })),
        };
      }),
    [data.academicEvents, examDetailsByEvent, schoolByKey, schoolCatalog]
  );

  const filteredEvents = useMemo(() => {
    const query = text(deferredSearchQuery).toLowerCase();
    return events.filter((event) => {
      if (selectedCategory !== 'all' && schoolByKey[event.schoolKey]?.category !== selectedCategory) return false;
      if (selectedSchoolKey !== 'all' && event.schoolKey !== selectedSchoolKey) return false;
      if (selectedGrades.length > 0) {
        const eventGrades = getEventGradeTokens(event);
        if (event.grade !== 'all' && eventGrades.length > 0 && !eventGrades.some((grade) => selectedGrades.includes(grade))) {
          return false;
        }
      }
      if (!selectedTypes.includes(event.type)) return false;
      if (query) {
        const haystack = [event.title, event.school, event.note, event.type, ...(event.tags || [])].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [deferredSearchQuery, events, schoolByKey, selectedCategory, selectedGrades, selectedSchoolKey, selectedTypes]);

  const weeks = useMemo(() => buildMonthWeeks(currentDate), [currentDate]);
  const gridStart = formatDate(weeks[0][0]);
  const gridEnd = formatDate(weeks[weeks.length - 1][6]);
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

  const writeState = useMemo(
    () => (calendarWriteIssue ? getAcademicCalendarWriteState(calendarWriteIssue, { canWriteCalendar }) : null),
    [calendarWriteIssue, canWriteCalendar]
  );
  const supportsExamDetails = !workspaceSupport.missingOptionalTables?.includes('academic_event_exam_details');

  const persistTypeDefinitions = async (nextDefinitions) => {
    const normalizedDefinitions = normalizeEventTypeDefinitions(
      (nextDefinitions || []).map((item, index) => ({
        ...item,
        name: text(item.name),
        color: pickEventTypeColor(item.name, index),
      }))
    );
    setEventTypeOptions(normalizedDefinitions);
    setSelectedTypes((current) => {
      const allowed = new Set(normalizedDefinitions.map((item) => item.name));
      const normalized = current.filter((item) => allowed.has(item));
      return normalized.length > 0 ? normalized : normalizedDefinitions.map((item) => item.name);
    });
    persistLocalStorageJson(EVENT_TYPE_STORAGE_KEY, normalizedDefinitions);
    try {
      await dataService.setAppPreference('academic-calendar:event-types', normalizedDefinitions);
    } catch {
      // Server persistence is optional.
    }
  };

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
        category: existing.category || inferCategory(draft.grade),
        color: existing.color || DEFAULT_EVENT_COLOR,
        sortOrder: 0,
      },
    ]);
    return savedSchool;
  };

  const closeModal = () => setEditingEvent(null);

  const buildCreateDraft = (start, end = start) => {
    const defaultSchool = selectedSchoolKey === 'all' ? null : schoolByKey[selectedSchoolKey];
    return {
      ...buildEmptyEvent(start, defaultSchool),
      end,
      category: selectedCategory === 'all' ? defaultSchool?.category || 'all' : selectedCategory,
      schoolKey: selectedSchoolKey === 'all' ? '' : defaultSchool?.name ? schoolKey(defaultSchool.name) : '',
      schoolId: selectedSchoolKey === 'all' ? '' : defaultSchool?.id || '',
      school: selectedSchoolKey === 'all' ? '' : defaultSchool?.name || '',
      grade: selectedGrades.length === 1 ? selectedGrades[0] : '',
      grades: selectedGrades,
      type: selectedTypes[0] || eventTypeOptions[0]?.name || '시험',
    };
  };

  const buildInlineComposerAnchor = (anchorDate, start, end) => {
    const containerNode = calendarMainRef.current;
    const anchorNode = dayButtonRefs.current.get(anchorDate || start);
    const width = 380;
    const label =
      start === end
        ? formatDisplayDateWithWeekday(start)
        : `${formatDisplayDate(start)} - ${formatDisplayDate(end)}`;

    if (!containerNode || !anchorNode) {
      return { top: 12, left: 12, width, label };
    }

    const containerRect = containerNode.getBoundingClientRect();
    const anchorRect = anchorNode.getBoundingClientRect();
    const gap = 14;
    const composerHeight = 452;
    const scrollLeft = containerNode.scrollLeft || 0;
    const scrollTop = containerNode.scrollTop || 0;
    const relativeLeft = anchorRect.left - containerRect.left + scrollLeft;
    const relativeRight = anchorRect.right - containerRect.left + scrollLeft;
    const relativeTop = anchorRect.top - containerRect.top + scrollTop;
    const maxLeft = Math.max(12, containerNode.scrollWidth - width - 12);
    const maxTop = Math.max(12, containerNode.scrollHeight - composerHeight - 12);

    let left = relativeRight + gap;
    if (left > maxLeft) {
      left = Math.max(12, relativeLeft - width - gap);
    }

    return {
      top: Math.min(Math.max(12, relativeTop), maxTop),
      left,
      width,
      label,
    };
  };

  const openCreateComposer = (start, end = start, anchorDate = start) => {
    const nextDraft = buildCreateDraft(start, end);
    closeModal();
    if (isMobile || currentView !== 'month') {
      setEditingEvent(nextDraft);
      return;
    }
    setInlineComposerDraft(nextDraft);
    setInlineComposerAnchor(buildInlineComposerAnchor(anchorDate, start, end));
  };

  const updateInlineComposerDraft = (patch) => {
    setInlineComposerDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const openExistingEvent = (event) => {
    closeInlineComposer();
    setEditingEvent(event);
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

    setIsSaving(true);
    try {
      const hasAssignedSchool = Boolean(text(nextDraft.schoolKey) || text(nextDraft.school));
      const school = hasAssignedSchool ? await ensureSchoolRecord(nextDraft) : null;
      const normalizedGrades = joinGradeTokens(nextDraft.grades || splitGradeTokens(nextDraft.grade));
      const payload = {
        title: text(nextDraft.title),
        schoolId: school?.id || null,
        school: school?.name || '',
        type: normalizeType(nextDraft.type),
        start: nextDraft.start,
        end: nextDraft.end || nextDraft.start,
        grade: normalizedGrades || 'all',
        note: mergeNoteMeta(nextDraft.note, {
          tags: normalizeTags(nextDraft.tags || []),
          rangeEnd: nextDraft.end && nextDraft.end !== nextDraft.start ? nextDraft.end : '',
        }),
        color: getEventColor(nextDraft, typeColorMap),
      };

      const savedEvent = nextDraft.id
        ? await dataService.updateAcademicEvent(nextDraft.id, payload).then(() => ({ id: nextDraft.id, ...payload }))
        : await dataService.addAcademicEvent(payload);

      if (supportsExamDetails && payload.type === '시험') {
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

  const deleteEvent = async () => {
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
        XLSX.utils.json_to_sheet((schoolCatalog || []).map((school) => ({ 학교명: school.name, 구분: categoryLabel(school.category), 색상: school.color }))),
        '학교목록'
      );
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), '교과정보');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), '부교재');
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet([
          {
            제목: '1학기 중간고사',
            학교명: schoolCatalog[0]?.name || '',
            학년: schoolCatalog[0]?.grades?.[0] || '고1',
            분류: '시험',
            시작일: `${new Date().getFullYear()}-04-22`,
            종료일: `${new Date().getFullYear()}-04-24`,
            비고: '',
            과목: '영어',
            시험일: '',
            교과서범위: '',
            부교재범위: '',
            기타범위: '',
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
          schools: getRows('학교목록').map((row) => ({ name: row.학교명 || '', category: row.구분 || '', color: row.색상 || '' })),
          profiles: getRows('교과정보').map((row) => ({ schoolName: row.학교명 || '', grade: row.학년 || '', subject: row.과목 || '', mainTextbookTitle: row.교과서 || '', mainTextbookPublisher: row.출판사 || '', note: row.비고 || '' })),
          materials: getRows('부교재').map((row, index) => ({ schoolName: row.학교명 || '', grade: row.학년 || '', subject: row.과목 || '', title: row.부교재 || '', publisher: row.출판사 || '', note: row.비고 || '', sortOrder: index })),
          events: getRows('학사일정').map((row) => ({ title: row.제목 || '', schoolName: row.학교명 || '', grade: row.학년 || '', type: row.분류 || '', start: row.시작일 || '', end: row.종료일 || '', note: row.비고 || '', examDetails: row.과목 || row.시험일 ? [{ id: createId(), schoolName: row.학교명 || '', grade: row.학년 || '', subject: row.과목 || '', examDateStatus: row.시험일 ? 'exact' : 'tbd', examDate: row.시험일 || '', textbookScope: row.교과서범위 || '', supplementScope: row.부교재범위 || '', otherScope: row.기타범위 || '', note: '' }] : [] })),
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
          category: row.category || matched?.category || inferCategory(row.grade),
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

  const sidebarContent = (
    <div className="academic-calendar-sidebar-content">
      <div className="card-custom academic-sidebar-panel academic-sidebar-search-panel">
        <div className="academic-section-caption">빠른 찾기</div>
        <div className="academic-toolbar-search academic-sidebar-search">
          <Search size={16} />
          <input
            ref={searchInputRef}
            className="styled-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="학교명, 일정명, 메모 검색"
          />
        </div>
        {isMobile ? (
          <div className="academic-sidebar-inline-actions">
            <button type="button" className="action-chip" onClick={() => setIsFilterSheetOpen(false)}>
              필터 닫기
            </button>
          </div>
        ) : null}
      </div>

      <div className="academic-mini-calendar card-custom">
        <div className="academic-mini-calendar-header">
          <button type="button" className="academic-icon-button" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
          <strong>{monthLabel}</strong>
          <button type="button" className="academic-icon-button" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="academic-mini-weekdays">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
        <div className="academic-mini-grid">
          {weeks.flat().map((day) => {
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
          <button type="button" className="action-chip academic-mini-calendar-today" onClick={() => setCurrentDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            오늘로 이동
          </button>
        </div>
      </div>

      <div className="card-custom academic-sidebar-panel">
        <div className="academic-section-caption">필터</div>
        <div className="academic-sidebar-field">
          <span>구분</span>
          <select className="styled-input" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
            {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="academic-sidebar-field">
          <span>학교</span>
          <select className="styled-input" value={selectedSchoolKey} onChange={(event) => setSelectedSchoolKey(event.target.value)}>
            <option value="all">전체 학교</option>
            {visibleSchools.map((school) => <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>)}
          </select>
        </div>
        <div className="academic-sidebar-field">
          <span>학년</span>
          <GradeMultiSelect
            options={gradeOptions.filter((grade) => grade !== 'all')}
            selectedValues={selectedGrades}
            onChange={setSelectedGrades}
            clearLabel="전체 학년"
          />
        </div>
      </div>

      <div className="card-custom academic-sidebar-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <div className="academic-section-caption">분류 필터</div>
          <button type="button" className="action-chip" onClick={() => setIsTypeManagerOpen(true)}><Settings2 size={14} />분류 관리</button>
        </div>
        <div className="academic-type-filter-wrap">
          {eventTypeOptions.map((type) => {
            const active = selectedTypes.includes(type.name);
            return (
              <button key={type.id} type="button" className={`academic-type-filter ${active ? 'is-active' : ''}`} style={{ '--type-color': type.color }} onClick={() => setSelectedTypes((current) => current.includes(type.name) ? current.filter((value) => value !== type.name) : [...current, type.name])}>
                {type.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="view-container academic-calendar-app">
      <input ref={uploadRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(event) => uploadWorkbook(event.target.files?.[0])} />

      <AcademicEventModal open={Boolean(editingEvent)} draft={editingEvent} schoolCatalog={schoolCatalog} typeDefinitions={eventTypeOptions} curriculumData={{ academicCurriculumProfiles: data.academicCurriculumProfiles || [], academicSupplementMaterials: data.academicSupplementMaterials || [], academyCurriculumPlans: data.academyCurriculumPlans || [], academyCurriculumMaterials: data.academyCurriculumMaterials || [], textbooks: data.textbooks || [], classes: data.classes || [] }} onClose={closeModal} onSave={saveEvent} onDelete={deleteEvent} isSaving={isSaving} canEdit={canWriteCalendar} supportsExamDetails={supportsExamDetails} />

      <AcademicTypeManagerModal open={isTypeManagerOpen} definitions={eventTypeOptions} onClose={() => setIsTypeManagerOpen(false)} onSave={persistTypeDefinitions} />

      <AcademicDayDialog open={Boolean(dayDialogDate)} title={dayDialogDate ? formatDisplayDateWithWeekday(dayDialogDate) : ''} events={dayDialogEvents} onClose={() => setDayDialogDate('')} typeColorMap={typeColorMap} />

      <BottomSheet open={isMobile && isFilterSheetOpen} onClose={() => setIsFilterSheetOpen(false)} title="캘린더 필터" subtitle="학교, 학년, 분류 기준으로 일정을 좁혀 볼 수 있습니다." maxWidth={520} actions={<div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="action-chip" onClick={() => setIsFilterSheetOpen(false)}>닫기</button></div>}>
        {sidebarContent}
      </BottomSheet>

      <ConfirmDialog {...dialogProps} />

      <section className="workspace-surface academic-calendar-workspace">
        <div className="academic-calendar-toolbar card-custom">
          <div className="academic-calendar-toolbar-main">
            <div className="academic-calendar-title-block">
              <div className="view-header-icon"><CalendarIcon size={22} /></div>
              <div>
                <div className="view-header-eyebrow">학사 캘린더</div>
                <h1 className="view-title">학사 일정</h1>
                <p className="view-subtitle">학교와 학년 기준으로 학사 일정을 관리하고, 시험 일정도 한 캘린더 안에서 함께 정리합니다.</p>
              </div>
            </div>
            <div className="academic-calendar-toolbar-actions">
              <button type="button" className="action-chip" onClick={downloadTemplate} disabled={isBusy}><Download size={16} />템플릿 다운로드</button>
              <button type="button" className="action-chip" onClick={() => uploadRef.current?.click()} disabled={!canUpload || isBusy}><Upload size={16} />데이터 업로드</button>
            </div>
          </div>

          <div className="academic-calendar-toolbar-sub">
            <div className="academic-toolbar-controls">
              {isMobile ? <button type="button" className="action-chip" onClick={() => setIsFilterSheetOpen(true)}><Settings2 size={16} />필터</button> : null}
              <div className="academic-view-toggle">
                <button type="button" className={currentView === 'month' ? 'action-pill' : 'action-chip'} onClick={() => setCurrentView('month')} aria-pressed={currentView === 'month'}><LayoutGrid size={16} />월간 보기</button>
                <button type="button" className={currentView === 'agenda' ? 'action-pill' : 'action-chip'} onClick={() => setCurrentView('agenda')} aria-pressed={currentView === 'agenda'}><List size={16} />일정 보기</button>
              </div>
              <div className="academic-month-nav">
                <button type="button" className="academic-icon-button" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
                <div className="academic-month-label-block">
                  <strong>{monthLabel}</strong>
                  <span>현재 필터 기준 일정 {currentView === 'month' ? monthEvents.length : agendaEvents.length}건</span>
                </div>
                <button type="button" className="academic-icon-button" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>
        </div>

        {writeState ? <StatusBanner variant={writeState.tone === 'danger' ? 'error' : 'warning'} title={writeState.title} message={writeState.message} /> : null}

        <div className="academic-calendar-shell">
          {!isMobile ? <aside className="academic-calendar-sidebar">{sidebarContent}</aside> : null}
          <main ref={calendarMainRef} className="academic-calendar-main">
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
                isSaving={isSaving}
                supportsExamDetails={supportsExamDetails}
              />
            ) : null}
            {currentView === 'month' ? (
              <AcademicMonthGridV2 currentDate={currentDate} weeks={weeks} monthEvents={monthEvents} dayEventMap={dayEventMap} typeColorMap={typeColorMap} selectionAnchor={selectionAnchor} selectionRange={selectionRange} setSelectionAnchor={setSelectionAnchor} setSelectionRange={setSelectionRange} canWriteCalendar={canWriteCalendar} draggedEventId={draggedEventId} setDraggedEventId={setDraggedEventId} onOpenDay={setDayDialogDate} onOpenEvent={openExistingEvent} onCreateRange={openCreateComposer} onMoveEvent={moveEvent} visibleLaneCount={isMobile ? 1 : 2} dayButtonRefs={dayButtonRefs} />
            ) : (
              <AcademicAgendaList groups={agendaGroups} onOpenEvent={openExistingEvent} typeColorMap={typeColorMap} />
            )}
          </main>
        </div>
      </section>
    </div>
  );
}




