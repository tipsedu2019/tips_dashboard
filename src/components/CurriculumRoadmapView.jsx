import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, FileDown, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import BottomSheet from './ui/BottomSheet';
import ConfirmDialog from './ui/ConfirmDialog';
import StatusBanner from './ui/StatusBanner';
import { DashboardFilterSheet, DashboardTopRail } from './ui/dashboard';
import { CheckboxMenu, SegmentedControl, Switch } from './ui/tds';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import useViewport from '../hooks/useViewport';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import {
  buildSchoolMaster,
  getAllManagedGrades,
  getSchoolCategoryLabel,
  getGradeOptionsForSelection,
  getGradeSortValue,
  getGradesForSchoolCategory,
  inferSchoolCategoryFromGrade,
  normalizeSchoolCategory as normalizeSharedSchoolCategory,
  SCHOOL_CATEGORY_FILTER_OPTIONS,
} from '../lib/schoolConfig';
import { dataService as sharedDataService } from '../services/dataService';

const DEFAULT_SUBJECT_OPTIONS = ['영어', '수학'];
const GRADE_ORDER = getAllManagedGrades();
const SCHOOL_CATEGORY_OPTIONS = SCHOOL_CATEGORY_FILTER_OPTIONS;
const FIXED_PERIODS = [
  { code: 'S1_MID', label: '1학기 중간', sortOrder: 1, periodType: 'fixed' },
  { code: 'S1_FINAL', label: '1학기 기말', sortOrder: 2, periodType: 'fixed' },
  { code: 'S2_MID', label: '2학기 중간', sortOrder: 3, periodType: 'fixed' },
  { code: 'S2_FINAL', label: '2학기 기말', sortOrder: 4, periodType: 'fixed' },
];
const MATERIAL_SECTIONS = [
  { key: 'textbook', label: '교과서' },
  { key: 'supplement', label: '부교재' },
  { key: 'other', label: '기타' },
];

const ALL_SCHOOLS = 'all-schools';
const ALL_GRADES = 'all-grades';
const ALL_PERIODS = 'all-periods';
const ALL_SUBJECTS = 'all-subjects';
const ALL_ACADEMY_GRADES = 'all-academy-grades';
const ALL_CLASSES = 'all-classes';
const VACATION_MISC_EVENT_TYPE = '방학·휴일·기타';
const SUBJECT_OPTIONS = DEFAULT_SUBJECT_OPTIONS;
const SCHOOL_VIEW_PRESETS = [
  { value: 'school-grade-by-period', label: '시기별 편집' },
  { value: 'school-by-grade', label: '학교 x 학년' },
  { value: 'school-annual-board', label: '학교 연간표' },
];
const ACADEMY_VIEW_PRESETS = [
  { value: 'class-by-period', label: '수업 x 시기' },
  { value: 'grade-by-period', label: '학년 x 시기' },
  { value: 'period-by-grade', label: '시기 x 학년' },
];
const ROADMAP_EVENT_TYPES = ['시험기간', '영어시험일', '수학시험일', '체험학습', VACATION_MISC_EVENT_TYPE, '팁스'];
const ROADMAP_SCHEDULE_COLUMNS = [
  { key: 'assessment', label: '시험 일정', types: ['시험기간', '영어시험일', '수학시험일'] },
  { key: 'field-trip', label: '체험학습', types: ['체험학습'] },
  { key: 'vacation-misc', label: '방학·휴일·기타', types: [VACATION_MISC_EVENT_TYPE] },
];

const SUBJECT_OPTIONS_KO = ['영어', '수학'];
const FIXED_PERIODS_KO = [
  { code: 'S1_MID', label: '1학기 중간', sortOrder: 1, periodType: 'fixed' },
  { code: 'S1_FINAL', label: '1학기 기말', sortOrder: 2, periodType: 'fixed' },
  { code: 'S2_MID', label: '2학기 중간', sortOrder: 3, periodType: 'fixed' },
  { code: 'S2_FINAL', label: '2학기 기말', sortOrder: 4, periodType: 'fixed' },
];
const MATERIAL_SECTION_DEFINITIONS = [
  { key: 'textbook', label: '교과서' },
  { key: 'supplement', label: '부교재' },
  { key: 'other', label: '기타' },
];
const SCHOOL_VIEW_PRESET_OPTIONS = [
  { value: 'school-grade-by-period', label: '시기별 편집' },
  { value: 'school-by-grade', label: '학교 x 학년' },
  { value: 'school-annual-board', label: '학교 연간표' },
];
const ACADEMY_VIEW_PRESET_OPTIONS = [
  { value: 'class-by-period', label: '수업 x 시기' },
  { value: 'grade-by-period', label: '학년 x 시기' },
  { value: 'period-by-grade', label: '시기 x 학년' },
];
const ROADMAP_EVENT_TYPE_OPTIONS = ['시험기간', '영어시험일', '수학시험일', '체험학습', VACATION_MISC_EVENT_TYPE, '팁스'];
const ROADMAP_SCHEDULE_COLUMN_OPTIONS = [
  { key: 'assessment', label: '시험 일정', types: ['시험기간', '영어시험일', '수학시험일'] },
  { key: 'field-trip', label: '체험학습', types: ['체험학습'] },
  { key: 'vacation-misc', label: '방학·휴일·기타', types: [VACATION_MISC_EVENT_TYPE] },
];
const ROADMAP_LINKED_EVENT_TYPES = ROADMAP_SCHEDULE_COLUMN_OPTIONS.flatMap((column) => column.types);
const ROADMAP_EDITOR_EVENT_TYPE_BY_SUBJECT = {
  영어: '영어시험일',
  수학: '수학시험일',
};
const ROADMAP_EDITOR_SHARED_EVENT_TYPES = ['시험기간', '체험학습', VACATION_MISC_EVENT_TYPE];
const ROADMAP_EVENT_COLOR_BY_TYPE = {
  시험기간: '#2f6f63',
  영어시험일: '#4f6fe8',
  수학시험일: '#7a52d1',
  체험학습: '#2f8f73',
  [VACATION_MISC_EVENT_TYPE]: '#d07a2b',
};
const SCHOOL_ANNUAL_BOARD_LABEL = '학교 연간일정표';

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function text(value) {
  return String(value || '').trim();
}

function schoolKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function gradeSort(value) {
  return getGradeSortValue(value);
}

function normalizeSchoolCategory(category, fallback = 'high') {
  return normalizeSharedSchoolCategory(category, fallback);
}

function inferSchoolCategoryFromName(name) {
  const normalized = text(name);
  if (!normalized) return 'high';
  if (/(?:초등학교|초[1-6]|초$)/u.test(normalized)) return 'elementary';
  if (/(?:중학교|중[1-3]|중$)/u.test(normalized)) return 'middle';
  return 'high';
}

function gradeGroupFromGrade(grade) {
  const normalized = text(grade);
  if (normalized.startsWith('초')) return 'elementary';
  if (normalized.startsWith('중')) return 'middle';
  return 'high';
}

function getGradesForGroup(group) {
  if (group === 'elementary') return GRADE_ORDER.filter((grade) => grade.startsWith('초'));
  if (group === 'middle') return GRADE_ORDER.filter((grade) => grade.startsWith('중'));
  return GRADE_ORDER.filter((grade) => grade.startsWith('고'));
}

function mergeGradeLists(...collections) {
  return [...new Set(collections.flat().map((value) => text(value)).filter(Boolean))]
    .sort((left, right) => gradeSort(left) - gradeSort(right) || left.localeCompare(right, 'ko'));
}

function normalizeAcademyGradeLabel(value) {
  const normalized = text(value);
  if (normalized === 'elementary') return '초등';
  if (normalized === 'middle') return '중등';
  if (normalized === 'high') return '고등';
  return normalized;
}

function buildSubjectOptions(data = {}) {
  const values = new Set(SUBJECT_OPTIONS_KO);
  [
    ...(data.classes || []),
    ...(data.academicCurriculumProfiles || []),
    ...(data.academicExamMaterialPlans || []),
    ...(data.academyCurriculumPlans || []),
    ...(data.academyCurriculumPeriodPlans || []),
    ...(data.academyCurriculumPeriodCatalogs || []),
  ].forEach((row) => {
    const subject = text(row?.subject);
    if (subject) values.add(subject);
  });
  return [...values];
}

function buildYearOptions(data = {}) {
  const values = new Set([new Date().getFullYear()]);
  [
    ...(data.academicExamMaterialPlans || []),
    ...(data.academyCurriculumPeriodPlans || []),
    ...(data.academyCurriculumPeriodCatalogs || []),
    ...(data.academicCurriculumProfiles || []),
    ...(data.academyCurriculumPlans || []),
    ...(data.classTerms || []),
  ].forEach((row) => {
    const year = Number(row?.academicYear || row?.academic_year || 0);
    if (year) values.add(year);
  });
  return [...values].sort((left, right) => right - left);
}

function buildSchoolCatalog(students = [], academicSchools = []) {
  const buckets = new Map();

  const ensureSchool = (input = {}) => {
    const name = text(input.name);
    if (!name) return null;
    const key = schoolKey(name);
    const explicitCategory = text(input.category);
    const nextCategory = normalizeSchoolCategory(
      explicitCategory || gradeGroupFromGrade(input.grade),
      inferSchoolCategoryFromName(name)
    );

    if (!buckets.has(key)) {
      buckets.set(key, {
        id: input.id || '',
        name,
        color: input.color || '#216e4e',
        category: nextCategory,
        grades: new Set(),
      });
    }

    const target = buckets.get(key);
    target.id = input.id || target.id || '';
    target.name = name;
    target.color = input.color || target.color || '#216e4e';
    target.category = explicitCategory
      ? normalizeSchoolCategory(explicitCategory, target.category || nextCategory)
      : target.category || nextCategory;
    if (input.grade) {
      target.grades.add(text(input.grade));
    }
    return target;
  };

  (academicSchools || []).forEach((school) => {
    ensureSchool({
      id: school.id,
      name: school.name,
      color: school.color,
      category: school.category,
    });
  });

  (students || []).forEach((student) => {
    ensureSchool({
      name: student.school,
      grade: student.grade,
    });
  });

  return [...buckets.values()]
    .map((school) => ({
      ...school,
      category: normalizeSchoolCategory(school.category, inferSchoolCategoryFromName(school.name)),
      grades: mergeGradeLists(
        getGradesForGroup(normalizeSchoolCategory(school.category, inferSchoolCategoryFromName(school.name))),
        [...school.grades]
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function buildEditorAnchor(rect) {
  const width = Math.min(760, Math.max(620, rect.width + 140));
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 960;
  let left = rect.left;
  let top = rect.bottom + 12;
  if (left + width > viewportWidth - 24) {
    left = Math.max(24, viewportWidth - width - 24);
  }
  if (top + 640 > viewportHeight - 24) {
    top = Math.max(24, rect.top - 640 - 12);
  }
  return { left, top, width };
}

function splitGradeValues(value = '') {
  const normalized = text(value);
  if (!normalized || normalized === 'all') return [];
  return [...new Set(normalized.split(/[,\n/]+/).map((item) => text(item)).filter(Boolean))];
}

function normalizeSelectionValues(values = []) {
  return [...new Set((values || []).map((value) => text(value)).filter(Boolean))];
}

function matchesSelectedSubject(subject, selectedSubject) {
  const normalizedSelectedSubject = text(selectedSubject);
  if (!normalizedSelectedSubject || normalizedSelectedSubject === ALL_SUBJECTS) {
    return true;
  }
  return text(subject) === normalizedSelectedSubject;
}

function formatSelectionSummary(labels = [], emptyLabel, suffix = '개') {
  const normalizedLabels = normalizeSelectionValues(labels);
  if (normalizedLabels.length === 0) {
    return emptyLabel;
  }
  if (normalizedLabels.length === 1) {
    return normalizedLabels[0];
  }
  return `${normalizedLabels[0]} 외 ${normalizedLabels.length - 1}${suffix}`;
}

function formatRoadmapDateLabel(value) {
  const normalized = text(value);
  if (!normalized) return '';
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRoadmapDateRange(start, end = start) {
  const safeStart = text(start);
  const safeEnd = text(end) || safeStart;
  if (!safeStart) return '';
  const startLabel = formatRoadmapDateLabel(safeStart);
  const endLabel = formatRoadmapDateLabel(safeEnd);
  return startLabel === endLabel ? startLabel : `${startLabel} ~ ${endLabel}`;
}

function parseRoadmapDate(value = '') {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareRoadmapLinkedEvents(left, right) {
  const leftStart = text(left?.start);
  const rightStart = text(right?.start);
  if (leftStart !== rightStart) {
    return leftStart.localeCompare(rightStart);
  }
  const leftEnd = text(left?.end || left?.start);
  const rightEnd = text(right?.end || right?.start);
  if (leftEnd !== rightEnd) {
    return leftEnd.localeCompare(rightEnd);
  }
  return text(left?.title).localeCompare(text(right?.title), 'ko');
}

function isPastRoadmapLinkedEvent(event, referenceDate = new Date()) {
  const todayLabel = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}-${String(referenceDate.getDate()).padStart(2, '0')}`;
  const eventEnd = text(event?.end || event?.start);
  return Boolean(eventEnd && eventEnd < todayLabel);
}

function buildRoadmapLinkedEventSummary(event) {
  const gradeValues = splitGradeValues(event?.grade);
  const gradeLabel = gradeValues.length > 0 ? gradeValues.join(', ') : '공통';
  const dateLabel = formatRoadmapDateRange(event?.start, event?.end);
  return [text(event?.title), gradeLabel, dateLabel].filter(Boolean).join(' · ');
}

function inferRoadmapPeriodCodeFromMonth(value = '') {
  const normalized = text(value);
  if (!normalized) return '';
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'S1_MID';
  if (month >= 6 && month <= 7) return 'S1_FINAL';
  if (month >= 8 && month <= 10) return 'S2_MID';
  return 'S2_FINAL';
}

function mergeEmbeddedNoteMeta(note, meta = {}) {
  const marker = '[[TIPS_META]]';
  const cleanNote = text(note);
  const compactMeta = Object.fromEntries(
    Object.entries(meta || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  if (Object.keys(compactMeta).length === 0) {
    return cleanNote || null;
  }
  return `${cleanNote ? `${cleanNote}\n\n` : ''}${marker}${JSON.stringify(compactMeta)}`;
}

function buildSchoolAssessmentKey(schoolId, academicYear, grade, periodCode) {
  return `${schoolId || ''}::${Number(academicYear) || 0}::${text(grade)}::${periodCode || ''}`;
}

function buildAcademyStackKey(row) {
  return `${row.scopeType}::${row.classId || ''}::${row.academyGrade}`;
}

function normalizeRoadmapEventType(value) {
  const normalized = text(value);
  if (!normalized) return '';
  if (normalized.includes('시험기간')) return '시험기간';
  if (normalized.includes('영어시험일')) return '영어시험일';
  if (normalized.includes('수학시험일')) return '수학시험일';
  if (normalized.includes('체험') || normalized.includes('학습')) return '체험학습';
  if (
    normalized.includes('방학') ||
    normalized.includes('개학') ||
    normalized.includes('휴일') ||
    normalized.includes('공휴일') ||
    normalized.includes('대체휴일') ||
    normalized.includes('휴강')
  ) {
    return VACATION_MISC_EVENT_TYPE;
  }
  if (normalized.includes('팁스') || normalized.includes('학원') || normalized.includes('행사')) {
    return '팁스';
  }
  if (normalized.includes('기타')) return VACATION_MISC_EVENT_TYPE;
  return normalized;
}

function getRoadmapEditorEventTypeOptions(subject = '') {
  const subjectType = ROADMAP_EDITOR_EVENT_TYPE_BY_SUBJECT[text(subject)] || '';
  return [...new Set([subjectType, ...ROADMAP_EDITOR_SHARED_EVENT_TYPES].filter(Boolean))];
}

function getDefaultRoadmapEditorEventType(subject = '') {
  return getRoadmapEditorEventTypeOptions(subject)[0] || '시험기간';
}

function normalizeRoadmapEditorEventType(value, subject = '') {
  const normalized = normalizeRoadmapEventType(value);
  const options = getRoadmapEditorEventTypeOptions(subject);
  return options.includes(normalized) ? normalized : getDefaultRoadmapEditorEventType(subject);
}

function getRoadmapScheduleEditorCopy(eventType = '시험기간') {
  const normalizedType = normalizeRoadmapEventType(eventType) || '시험기간';
  if (normalizedType === '시험기간') {
    return {
      description: '학사일정의 시험기간과 바로 연결되는 범위를 관리합니다.',
      startLabel: '시험 시작',
      endLabel: '시험 종료',
    };
  }
  return {
    description: '학사일정에 연결할 일정 종류와 날짜를 직접 입력합니다.',
    startLabel: '일정 시작',
    endLabel: '일정 종료',
  };
}

function buildRoadmapScheduleEventTitle(schoolName, periodLabel, eventType) {
  return [text(schoolName), text(periodLabel), normalizeRoadmapEventType(eventType) || '시험기간']
    .filter(Boolean)
    .join(' ');
}

function inferAssessmentPeriodCode(event) {
  const metaPeriodCode = text(event?.roadmapPeriodCode || event?.meta?.roadmapPeriodCode || event?.roadmapSync?.periodCode);
  if (metaPeriodCode) return metaPeriodCode;
  const source = `${text(event?.title)} ${text(event?.note)}`;
  if (source.includes('1학기') && source.includes('중간')) return 'S1_MID';
  if (source.includes('1학기') && source.includes('기말')) return 'S1_FINAL';
  if (source.includes('2학기') && source.includes('중간')) return 'S2_MID';
  if (source.includes('2학기') && source.includes('기말')) return 'S2_FINAL';
  return inferRoadmapPeriodCodeFromMonth(event?.start || event?.date || '');
}

function resolveAssessmentAcademicYear(event) {
  return (
    Number(event?.meta?.academicYear || event?.roadmapSync?.academicYear || String(event?.start || event?.date || '').slice(0, 4)) ||
    0
  );
}

function inferAssessmentSubject(event) {
  const metaSubject = text(event?.roadmapSubject || event?.meta?.roadmapSubject || event?.roadmapSync?.subject);
  if (metaSubject) return metaSubject;
  if (normalizeRoadmapEventType(event?.type) === '영어시험일') return '영어';
  if (normalizeRoadmapEventType(event?.type) === '수학시험일') return '수학';
  const source = `${text(event?.title)} ${text(event?.note)}`;
  return SUBJECT_OPTIONS_KO.find((subject) => source.includes(subject)) || '';
}

function resolveRoadmapSubject(event) {
  const metaSubject = text(event?.roadmapSubject || event?.meta?.roadmapSubject || event?.roadmapSync?.subject);
  if (metaSubject) return metaSubject;
  const eventType = normalizeRoadmapEventType(event?.type);
  if (eventType === '영어시험일') return '영어';
  if (eventType === '수학시험일') return '수학';
  const source = `${text(event?.title)} ${text(event?.note)}`;
  return SUBJECT_OPTIONS_KO.find((subject) => source.includes(subject)) || '';
}

function buildSchoolAssessmentLookup(events = [], selectedSubject = '') {
  const map = new Map();

  (events || []).forEach((event) => {
    const eventType = normalizeRoadmapEventType(event?.type);
    if (!ROADMAP_EVENT_TYPE_OPTIONS.includes(eventType) || !event?.schoolId) {
      return;
    }

    const periodCode = inferAssessmentPeriodCode(event);
    const gradeValues = splitGradeValues(event?.grade);
    if (!periodCode || gradeValues.length === 0) {
      return;
    }

    const eventSubject = resolveRoadmapSubject(event);
    const appliesToSubject = eventType === '시험기간' || !eventSubject || matchesSelectedSubject(eventSubject, selectedSubject);
    const appliesToSelectedSubject = eventType === '시험기간' || !eventSubject || matchesSelectedSubject(eventSubject, selectedSubject);
    if (!appliesToSelectedSubject) {
      return;
    }

    gradeValues.forEach((grade) => {
      const key = buildSchoolAssessmentKey(event.schoolId, resolveAssessmentAcademicYear(event), grade, periodCode);
      if (!map.has(key)) {
        map.set(key, {
          eventId: '',
          examWindowStart: '',
          examWindowEnd: '',
          lines: [],
          byType: new Map(),
          eventMetaByType: new Map(),
          eventsByType: new Map(),
          linkedEvents: [],
        });
      }

      const target = map.get(key);
      const linkedEvent = {
        id: text(event.id),
        schoolId: text(event.schoolId),
        schoolName: text(event.school),
        type: eventType,
        title: text(event.title),
        start: text(event.start),
        end: text(event.end) || text(event.start),
        grade,
        gradeValues: [grade],
        subject: eventSubject,
        summary: buildRoadmapLinkedEventSummary({ ...event, type: eventType, grade }),
      };
      const label = linkedEvent.summary;

      if (eventType === '시험기간') {
        target.eventId = event.id || target.eventId;
        target.examWindowStart = text(event.start) || target.examWindowStart;
        target.examWindowEnd = text(event.end) || text(event.start) || target.examWindowEnd;
      }

      if (!target.byType.has(eventType)) {
        target.byType.set(eventType, []);
      }
      const bucket = target.byType.get(eventType);
      if (label && !bucket.includes(label)) {
        bucket.push(label);
      }

      if (!target.eventsByType.has(eventType)) {
        target.eventsByType.set(eventType, []);
      }
      target.eventsByType.get(eventType).push(linkedEvent);

      const eventMeta = target.eventMetaByType.get(eventType);
      if (!eventMeta || !text(eventMeta.id)) {
        target.eventMetaByType.set(eventType, {
          id: text(event.id),
          start: text(event.start),
          end: text(event.end) || text(event.start),
          title: text(event.title),
          subject: eventSubject,
        });
      }
    });
  });

  map.forEach((entry) => {
    entry.linkedEvents = ROADMAP_SCHEDULE_COLUMN_OPTIONS
      .flatMap((column) => column.types.flatMap((type) => entry.eventsByType.get(type) || []))
      .sort(compareRoadmapLinkedEvents);
    entry.lines = entry.linkedEvents.map((event) => event.summary);
  });

  return map;
}

function buildScheduleEventsBySchool(
  events = [],
  selectedCategoryTypes = ROADMAP_SCHEDULE_COLUMN_OPTIONS,
  selectedYear = new Date().getFullYear()
) {
  const scheduleTypeSet = new Set(selectedCategoryTypes.flatMap((column) => column.types));
  const schoolMap = new Map();

  (events || []).forEach((event) => {
    const eventType = normalizeRoadmapEventType(event?.type);
    if (
      !scheduleTypeSet.has(eventType) ||
      !event?.schoolId ||
      resolveAssessmentAcademicYear(event) !== Number(selectedYear)
    ) {
      return;
    }
    const schoolId = event.schoolId;
    if (!schoolMap.has(schoolId)) {
      schoolMap.set(schoolId, new Map());
    }
    const bucketMap = schoolMap.get(schoolId);
    const displayGradeLabel =
      splitGradeValues(event?.grade).length > 0 ? splitGradeValues(event?.grade).join(', ') : '공통';
    const gradeValues = splitGradeValues(event?.grade);
    const gradeLabel = gradeValues.length > 0 ? gradeValues.join(', ') : '공통';
    const dateLabel = formatRoadmapDateRange(event.start, event.end);
    const title = text(event?.title);
    const normalizedGradeLabel = gradeValues.length > 0 ? gradeValues.join(', ') : '공통';
    const summary = [title, normalizedGradeLabel, dateLabel].filter(Boolean).join(' · ');
    if (!bucketMap.has(eventType)) {
      bucketMap.set(eventType, []);
    }
    const bucket = bucketMap.get(eventType);
    const displaySummary = [title, displayGradeLabel, dateLabel].filter(Boolean).join(' · ');
    if (displaySummary && !bucket.includes(displaySummary)) {
      bucket.push(displaySummary);
    }
  });

  return schoolMap;
}

function buildStructuredSchoolAssessmentLookup(events = [], selectedSubject = '') {
  const map = new Map();

  (events || []).forEach((event) => {
    const eventType = normalizeRoadmapEventType(event?.type);
    if (!ROADMAP_EVENT_TYPE_OPTIONS.includes(eventType) || !event?.schoolId) {
      return;
    }

    const periodCode = inferAssessmentPeriodCode(event);
    const gradeValues = splitGradeValues(event?.grade);
    if (!periodCode || gradeValues.length === 0) {
      return;
    }

    const eventSubject = resolveRoadmapSubject(event);
    const appliesToSelectedSubject = eventType === '시험기간' || !eventSubject || matchesSelectedSubject(eventSubject, selectedSubject);
    if (!appliesToSelectedSubject) {
      return;
    }

    gradeValues.forEach((grade) => {
      const key = buildSchoolAssessmentKey(event.schoolId, resolveAssessmentAcademicYear(event), grade, periodCode);
      if (!map.has(key)) {
        map.set(key, {
          eventId: '',
          examWindowStart: '',
          examWindowEnd: '',
          lines: [],
          byType: new Map(),
          eventMetaByType: new Map(),
          eventsByType: new Map(),
          linkedEvents: [],
        });
      }

      const target = map.get(key);
      const linkedEvent = {
        id: text(event.id),
        schoolId: text(event.schoolId),
        schoolName: text(event.school),
        type: eventType,
        title: text(event.title),
        start: text(event.start),
        end: text(event.end) || text(event.start),
        grade,
        gradeValues: [grade],
        subject: eventSubject,
        summary: buildRoadmapLinkedEventSummary({ ...event, type: eventType, grade }),
      };

      if (eventType === '시험기간') {
        target.eventId = event.id || target.eventId;
        target.examWindowStart = text(event.start) || target.examWindowStart;
        target.examWindowEnd = text(event.end) || text(event.start) || target.examWindowEnd;
      }

      if (!target.byType.has(eventType)) {
        target.byType.set(eventType, []);
      }
      const lineBucket = target.byType.get(eventType);
      if (linkedEvent.summary && !lineBucket.includes(linkedEvent.summary)) {
        lineBucket.push(linkedEvent.summary);
      }

      if (!target.eventsByType.has(eventType)) {
        target.eventsByType.set(eventType, []);
      }
      target.eventsByType.get(eventType).push(linkedEvent);

      const eventMeta = target.eventMetaByType.get(eventType);
      if (!eventMeta || !text(eventMeta.id)) {
        target.eventMetaByType.set(eventType, {
          id: text(event.id),
          start: text(event.start),
          end: text(event.end) || text(event.start),
          title: text(event.title),
          subject: eventSubject,
        });
      }
    });
  });

  map.forEach((entry) => {
    entry.linkedEvents = ROADMAP_LINKED_EVENT_TYPES
      .flatMap((type) => entry.eventsByType.get(type) || [])
      .sort(compareRoadmapLinkedEvents);
    entry.lines = entry.linkedEvents.map((event) => event.summary);
  });

  return map;
}

function buildStructuredScheduleEventsBySchool(
  events = [],
  selectedCategoryTypes = ROADMAP_SCHEDULE_COLUMN_OPTIONS,
  selectedYear = new Date().getFullYear()
) {
  const scheduleTypeSet = new Set(selectedCategoryTypes.flatMap((column) => column.types));
  const schoolMap = new Map();

  (events || []).forEach((event) => {
    const eventType = normalizeRoadmapEventType(event?.type);
    if (
      !scheduleTypeSet.has(eventType) ||
      !event?.schoolId ||
      resolveAssessmentAcademicYear(event) !== Number(selectedYear)
    ) {
      return;
    }

    if (!schoolMap.has(event.schoolId)) {
      schoolMap.set(event.schoolId, new Map());
    }

    const gradeValues = splitGradeValues(event?.grade);
    const gradeLabel = gradeValues.length > 0 ? gradeValues.join(', ') : '공통';
    const bucketMap = schoolMap.get(event.schoolId);
    if (!bucketMap.has(eventType)) {
      bucketMap.set(eventType, []);
    }
    bucketMap.get(eventType).push({
      id: text(event.id),
      schoolId: text(event.schoolId),
      schoolName: text(event.school),
      type: eventType,
      title: text(event.title),
      start: text(event.start),
      end: text(event.end) || text(event.start),
      grade: gradeValues.join(','),
      gradeValues,
      gradeLabel,
      summary: [text(event.title), gradeLabel, formatRoadmapDateRange(event.start, event.end)].filter(Boolean).join(' · '),
    });
  });

  schoolMap.forEach((bucketMap) => {
    bucketMap.forEach((bucket, key) => {
      bucketMap.set(key, [...bucket].sort(compareRoadmapLinkedEvents));
    });
  });

  return schoolMap;
}

function createEmptyMaterial(category) {
  return {
    id: createId(),
    materialCategory: category,
    title: '',
    publisher: '',
    detail: '',
  };
}

function buildDraftRows(items = [], detailField) {
  const grouped = {
    textbook: [],
    supplement: [],
    other: [],
  };

  (items || []).forEach((item) => {
    const category = MATERIAL_SECTION_DEFINITIONS.some((section) => section.key === item.materialCategory)
      ? item.materialCategory
      : 'other';
    grouped[category].push({
      id: item.id || createId(),
      materialCategory: category,
      title: text(item.title),
      publisher: text(item.publisher),
      detail: text(item[detailField]),
      textbookId: text(item.textbookId),
    });
  });

  MATERIAL_SECTION_DEFINITIONS.forEach((section) => {
    if (grouped[section.key].length === 0) {
      grouped[section.key] = [createEmptyMaterial(section.key)];
    }
  });

  return grouped;
}

function flattenDraftRows(rowsByCategory = {}) {
  return MATERIAL_SECTION_DEFINITIONS.flatMap((section) =>
    (rowsByCategory[section.key] || []).map((item, index) => ({
      id: item.id || createId(),
      materialCategory: section.key,
      textbookId: text(item.textbookId),
      title: text(item.title),
      publisher: text(item.publisher),
      detail: text(item.detail),
      note: '',
      sortOrder: index,
    }))
  ).filter((item) => item.title || item.publisher || item.detail);
}

function groupItemsByCategory(items = [], detailField) {
  const buckets = {
    textbook: [],
    supplement: [],
    other: [],
  };

  (items || []).forEach((item) => {
    const key = MATERIAL_SECTION_DEFINITIONS.some((section) => section.key === item.materialCategory)
      ? item.materialCategory
      : 'other';
    buckets[key].push({
      ...item,
      detail: text(item[detailField]),
    });
  });

  return buckets;
}

function formatItemLabel(item) {
  const parts = [text(item.title), text(item.publisher)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '입력 없음';
}

function buildPrintHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #162338; background: #eef2f7; font-family: "Noto Sans KR", "Apple SD Gothic Neo", sans-serif; }
      .roadmap-print-toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 20px 0;
        background: linear-gradient(to bottom, #eef2f7 0%, #eef2f7 72%, rgba(238,242,247,0) 100%);
      }
      .roadmap-print-action {
        min-height: 40px;
        padding: 0 16px;
        border: 1px solid #d4dde9;
        border-radius: 999px;
        background: #ffffff;
        color: #162338;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
      }
      .roadmap-print-wrap {
        max-width: 1400px;
        margin: 0 auto 24px;
        padding: 16px;
        background: #ffffff;
        border: 1px solid #d4dde9;
        border-radius: 24px;
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
      }
      .roadmap-print-wrap h1 { margin: 0 0 12px; font-size: 20px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #cfd8e6; vertical-align: top; padding: 8px; }
      th { background: #eef4fb; font-size: 12px; text-align: left; }
      td { font-size: 11px; }
      .roadmap-cell-stack { display: flex; flex-direction: column; gap: 8px; }
      .roadmap-cell-block { border: 1px solid #d8e2ef; border-radius: 10px; padding: 6px 8px; background: #fff; }
      .roadmap-cell-block-label { display: block; margin-bottom: 4px; color: #4b5a73; font-size: 10px; font-weight: 700; }
      .roadmap-cell-line { margin: 0; }
      .roadmap-cell-line + .roadmap-cell-line { margin-top: 4px; }
      .roadmap-cell-detail { color: #4f5e75; white-space: pre-wrap; }
      .roadmap-print-empty { color: #7a879b; }
      .roadmap-cell-empty {
        min-height: 48px;
        border: 0 !important;
        background: transparent !important;
        color: transparent !important;
        box-shadow: none !important;
      }
      .roadmap-cell-group + .roadmap-cell-group { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #d8e2ef; }
      .roadmap-cell-group-label { margin-bottom: 6px; color: #5d6d84; font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .roadmap-cell-assessment { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
      .roadmap-cell-assessment-line,
      .roadmap-schedule-item { padding: 6px 8px; border: 1px solid #d8e2ef; border-radius: 10px; background: #f8fbff; line-height: 1.45; white-space: pre-wrap; }
      .roadmap-schedule-list { display: flex; flex-direction: column; gap: 6px; }
      @media print {
        body { background: #ffffff; }
        .roadmap-print-toolbar { display: none; }
        .roadmap-print-wrap {
          max-width: none;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="roadmap-print-toolbar">
      <button type="button" class="roadmap-print-action" onclick="window.print()">PDF 저장</button>
      <button type="button" class="roadmap-print-action" onclick="window.close()">닫기</button>
    </div>
    <div class="roadmap-print-wrap">
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

function MaterialRowsEditor({ rows = [], detailLabel, titleSuggestions = [], onChangeRow, onAddRow, onRemoveRow }) {
  return (
    <div className="roadmap-editor-section-rows">
      {rows.map((row, index) => (
        <div key={row.id} className="roadmap-editor-row">
          <div className="roadmap-editor-row-head">
            <label className="academic-field roadmap-editor-field">
              <span>교재명</span>
              <input
                className="styled-input"
                list="roadmap-textbook-suggestions"
                value={row.title}
                onChange={(event) => onChangeRow(index, { title: event.target.value })}
                placeholder="교재명"
              />
            </label>
            <label className="academic-field roadmap-editor-field">
              <span>출판사</span>
              <input
                className="styled-input"
                value={row.publisher}
                onChange={(event) => onChangeRow(index, { publisher: event.target.value })}
                placeholder="출판사"
              />
            </label>
            <button
              type="button"
              className="academic-icon-button roadmap-editor-remove"
              onClick={() => onRemoveRow(index)}
              aria-label="행 삭제"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <label className="academic-field roadmap-editor-field roadmap-editor-field-detail">
            <span>{detailLabel}</span>
            <textarea
              className="styled-input"
              value={row.detail}
              onChange={(event) => onChangeRow(index, { detail: event.target.value })}
              placeholder={detailLabel}
              style={{ minHeight: 92, resize: 'vertical' }}
            />
          </label>
          <label className="academic-field roadmap-editor-field roadmap-editor-field-note">
            <span>메모</span>
            <input
              className="styled-input"
              value={row.note}
              onChange={(event) => onChangeRow(index, { note: event.target.value })}
              placeholder="필요할 때만 짧게 메모"
            />
          </label>
        </div>
      ))}
      <button type="button" className="roadmap-editor-add" onClick={onAddRow}>
        <Plus size={14} />
        줄 추가
      </button>
      <datalist id="roadmap-textbook-suggestions">
        {titleSuggestions.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
    </div>
  );
}

/* function LegacyRoadmapCellEditor({
  activeEditor,
  editorDraft,
  textbookSuggestions,
  isSaving,
  onClose,
  onChangeSchoolPeriod,
  onChangeNote,
  onChangeExamRange,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  onSave,
}) {
  if (!activeEditor || !editorDraft) {
    return null;
  }

  const hasMultiplePeriods =
    activeEditor.tab === 'school' &&
    Array.isArray(activeEditor.periodOptions) &&
    activeEditor.periodOptions.length > 1;

  return (
    <div
      className="roadmap-cell-editor"
      style={{
        position: 'fixed',
        left: activeEditor.anchor.left,
        top: activeEditor.anchor.top,
        width: activeEditor.anchor.width,
      }}
    >
      <div className="roadmap-cell-editor-head">
        <div>
          <div className="roadmap-cell-editor-eyebrow">{activeEditor.eyebrow}</div>
          <h3>{activeEditor.title}</h3>
          <p>{activeEditor.subtitle}</p>
        </div>
        <div className="roadmap-cell-editor-head-actions">
          <button
            type="button"
            className="academic-icon-button roadmap-cell-editor-icon"
            onClick={onSave}
            disabled={isSaving}
            aria-label="저장"
            title="저장"
          >
            <Save size={16} />
          </button>
          <button
            type="button"
            className="academic-icon-button roadmap-cell-editor-icon"
            onClick={onClose}
            aria-label="닫기"
            title="닫기"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="roadmap-cell-editor-body">
        {activeEditor.tab === 'school' ? (
          <section className="roadmap-editor-split-card">
            <div className="roadmap-editor-split-head">
              <strong>일정 입력</strong>
              <span>학사일정 시험 관련 정보와 직접 연결됩니다.</span>
            </div>
            <div className={`roadmap-editor-assessment-grid ${hasMultiplePeriods ? 'is-multi-period' : ''}`.trim()}>
              {hasMultiplePeriods ? (
                <label className="academic-field roadmap-editor-field roadmap-editor-field-period">
                  <span>시기</span>
                  <select
                    className="styled-input"
                    value={editorDraft.activePeriodCode || activeEditor.period?.code || ''}
                    onChange={(event) => onChangeSchoolPeriod(event.target.value)}
                  >
                    {activeEditor.periodOptions.map((period) => (
                      <option key={period.code} value={period.code}>{period.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="roadmap-editor-assessment-grid-row">
          <section className="roadmap-editor-split-card">
            <div className="roadmap-editor-split-head">
              <strong>일정 입력</strong>
              <span>학사일정 시험 관련 정보와 직접 연결됩니다.</span>
            </div>
            <div className={`roadmap-editor-assessment-grid ${hasMultiplePeriods ? 'is-multi-period' : ''}`.trim()}>
              {hasMultiplePeriods ? (
                <label className="academic-field roadmap-editor-field roadmap-editor-field-period">
                  <span>시기</span>
                  <select
                    className="styled-input"
                    value={editorDraft.activePeriodCode || activeEditor.period?.code || ''}
                    onChange={(event) => onChangeSchoolPeriod(event.target.value)}
                  >
                    {activeEditor.periodOptions.map((period) => (
                      <option key={period.code} value={period.code}>{period.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            <label className="academic-field roadmap-editor-field">
              <span>시험 시작</span>
              <input
                type="date"
                className="styled-input"
                value={editorDraft.examStart || ''}
                onChange={(event) => onChangeExamRange({ examStart: event.target.value })}
              />
            </label>
            <label className="academic-field roadmap-editor-field">
              <span>시험 종료</span>
              <input
                type="date"
                className="styled-input"
                value={editorDraft.examEnd || ''}
                onChange={(event) => onChangeExamRange({ examEnd: event.target.value })}
              />
            </label>
            </div>
          </section>
        ) : null}

        <section className="roadmap-editor-split-card">
          <div className="roadmap-editor-split-head">
            <strong>{activeEditor.tab === 'school' ? '교재·시험범위 입력' : '교재·진도 입력'}</strong>
            <span>교과서, 부교재, 기타 자료를 같은 셀에서 함께 관리합니다.</span>
          </div>
        {MATERIAL_SECTION_DEFINITIONS.map((section) => (
          <section key={section.key} className="roadmap-editor-section">
            <div className="roadmap-editor-section-title">{section.label}</div>
            <MaterialRowsEditor
              rows={editorDraft.rowsByCategory[section.key]}
              detailLabel={activeEditor.detailLabel}
              titleSuggestions={textbookSuggestions}
              onChangeRow={(rowIndex, patch) => onChangeRow(section.key, rowIndex, patch)}
              onAddRow={() => onAddRow(section.key)}
              onRemoveRow={(rowIndex) => onRemoveRow(section.key, rowIndex)}
            />
          </section>
        ))}

        <label className="academic-field roadmap-editor-note">
          <span>메모</span>
          <textarea
            className="styled-input"
            value={editorDraft.note}
            onChange={(event) => onChangeNote(event.target.value)}
            placeholder="추가 메모가 있으면 적어 주세요."
            style={{ minHeight: 88, resize: 'vertical' }}
          />
        </label>
      </div>

    </div>
  );
}

function LegacyRoadmapCell({ cell, onClick }) {
  const blocks = MATERIAL_SECTION_DEFINITIONS.map((section) => ({
    ...section,
    items: cell.itemsByCategory[section.key] || [],
  })).filter((section) => section.items.length > 0);

  return (
    <button type="button" className="roadmap-cell-button" onClick={onClick}>
      <div className="roadmap-cell-stack">
        {blocks.length === 0 ? (
          <div className="roadmap-cell-empty">클릭해서 입력</div>
        ) : (
          blocks.map((section) => (
            <div key={section.key} className="roadmap-cell-block">
              <span className="roadmap-cell-block-label">{section.label}</span>
              {section.items.map((item) => (
                <div key={item.id} className="roadmap-cell-line">
                  <strong>{formatItemLabel(item)}</strong>
                  {text(item.detail) ? <div className="roadmap-cell-detail">{item.detail}</div> : null}
                </div>
              ))}
            </div>
          ))
        )}
        {text(cell.note) ? <div className="roadmap-cell-note">{cell.note}</div> : null}
      </div>
    </button>
  );
}

*/
function RoadmapCellEditor({
  activeEditor,
  editorDraft,
  textbookSuggestions,
  isSaving,
  onClose,
  onChangeSchoolPeriod,
  onChangeNote,
  onChangeExamRange,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  onSave,
}) {
  if (!activeEditor || !editorDraft) {
    return null;
  }

  const hasMultiplePeriods =
    activeEditor.tab === 'school' &&
    Array.isArray(activeEditor.periodOptions) &&
    activeEditor.periodOptions.length > 1;

  return (
    <div
      className="roadmap-cell-editor"
      style={{
        position: 'fixed',
        left: activeEditor.anchor.left,
        top: activeEditor.anchor.top,
        width: activeEditor.anchor.width,
      }}
    >
      <div className="roadmap-cell-editor-head">
        <div>
          <div className="roadmap-cell-editor-eyebrow">{activeEditor.eyebrow}</div>
          <h3>{activeEditor.title}</h3>
          <p>{activeEditor.subtitle}</p>
        </div>
        <div className="roadmap-cell-editor-head-actions">
          <button
            type="button"
            className="academic-icon-button roadmap-cell-editor-icon"
            onClick={onSave}
            disabled={isSaving}
            aria-label="저장"
            title="저장"
          >
            <Save size={16} />
          </button>
          <button
            type="button"
            className="academic-icon-button roadmap-cell-editor-icon"
            onClick={onClose}
            aria-label="닫기"
            title="닫기"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="roadmap-cell-editor-body">
        {activeEditor.tab === 'school' ? (
          <div className="roadmap-editor-assessment-grid">
            <label className="academic-field roadmap-editor-field">
              <span>시험 시작</span>
              <input
                type="date"
                className="styled-input"
                value={editorDraft.examStart || ''}
                onChange={(event) => onChangeExamRange({ examStart: event.target.value })}
              />
            </label>
            <label className="academic-field roadmap-editor-field">
              <span>시험 종료</span>
              <input
                type="date"
                className="styled-input"
                value={editorDraft.examEnd || ''}
                onChange={(event) => onChangeExamRange({ examEnd: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        {MATERIAL_SECTION_DEFINITIONS.map((section) => (
          <section key={section.key} className="roadmap-editor-section">
            <div className="roadmap-editor-section-title">{section.label}</div>
            <MaterialRowsEditor
              rows={editorDraft.rowsByCategory[section.key]}
              detailLabel={activeEditor.detailLabel}
              titleSuggestions={textbookSuggestions}
              onChangeRow={(rowIndex, patch) => onChangeRow(section.key, rowIndex, patch)}
              onAddRow={() => onAddRow(section.key)}
              onRemoveRow={(rowIndex) => onRemoveRow(section.key, rowIndex)}
            />
          </section>
        ))}

        <label className="academic-field roadmap-editor-note">
          <span>메모</span>
          <textarea
            className="styled-input"
            value={editorDraft.note}
            onChange={(event) => onChangeNote(event.target.value)}
            placeholder="추가 메모가 있으면 적어 주세요."
            style={{ minHeight: 88, resize: 'vertical' }}
          />
        </label>
      </div>
    </div>
  );
}

function MaterialRowsEditorCompact({
  rows = [],
  detailLabel,
  titleSuggestions = [],
  onChangeRow,
  onAddRow,
  onRemoveRow,
}) {
  return (
    <div className="roadmap-editor-section-rows">
      {rows.map((row, index) => (
        <div key={row.id} className="roadmap-editor-row">
          <div className="roadmap-editor-row-head">
            <label className="academic-field roadmap-editor-field">
              <span>교재명</span>
              <input
                className="styled-input"
                list="roadmap-textbook-suggestions-compact"
                value={row.title}
                onChange={(event) => onChangeRow(index, { title: event.target.value })}
                placeholder="교재명"
              />
            </label>
            <label className="academic-field roadmap-editor-field">
              <span>출판사</span>
              <input
                className="styled-input"
                value={row.publisher}
                onChange={(event) => onChangeRow(index, { publisher: event.target.value })}
                placeholder="출판사"
              />
            </label>
            <button
              type="button"
              className="academic-icon-button roadmap-editor-remove"
              onClick={() => onRemoveRow(index)}
              aria-label="줄 삭제"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <label className="academic-field roadmap-editor-field roadmap-editor-field-detail">
            <span>{detailLabel}</span>
            <textarea
              className="styled-input"
              value={row.detail}
              onChange={(event) => onChangeRow(index, { detail: event.target.value })}
              placeholder={detailLabel}
              style={{ minHeight: 92, resize: 'vertical' }}
            />
          </label>
        </div>
      ))}
      <button type="button" className="roadmap-editor-add" onClick={onAddRow}>
        <Plus size={14} />
        줄 추가
      </button>
      <datalist id="roadmap-textbook-suggestions-compact">
        {titleSuggestions.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
    </div>
  );
}

function RoadmapCellEditorV2({
  activeEditor,
  editorDraft,
  textbookSuggestions,
  isSaving,
  onClose,
  onChangeSchoolPeriod,
  onChangeScheduleEventType,
  onChangeNote,
  onChangeExamRange,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  onSave,
  scheduleTypeOptions = [],
}) {
  if (!activeEditor || !editorDraft) {
    return null;
  }

  const hasMultiplePeriods =
    activeEditor.tab === 'school' &&
    Array.isArray(activeEditor.periodOptions) &&
    activeEditor.periodOptions.length > 1;
  const scheduleEventType = text(editorDraft.scheduleEventType) || scheduleTypeOptions[0] || '시험기간';
  const scheduleCopy = getRoadmapScheduleEditorCopy(scheduleEventType);

  return (
    <div
      className="roadmap-cell-editor roadmap-cell-editor-v2"
      style={{
        position: 'fixed',
        left: activeEditor.anchor.left,
        top: activeEditor.anchor.top,
        width: activeEditor.anchor.width,
      }}
    >
      <div className="roadmap-cell-editor-head">
        <div>
          <div className="roadmap-cell-editor-eyebrow">{activeEditor.eyebrow}</div>
          <h3>{activeEditor.title}</h3>
          <p>{activeEditor.subtitle}</p>
        </div>
        <div className="roadmap-cell-editor-head-actions">
          <button
            type="button"
            className="academic-icon-button roadmap-cell-editor-icon"
            onClick={onSave}
            disabled={isSaving}
            aria-label="저장"
            title="저장"
          >
            <Save size={16} />
          </button>
          <button
            type="button"
            className="academic-icon-button roadmap-cell-editor-icon"
            onClick={onClose}
            aria-label="닫기"
            title="닫기"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="roadmap-cell-editor-body">
        {activeEditor.tab === 'school' ? (
          <section className="roadmap-editor-split-card">
            <div className="roadmap-editor-split-head">
              <strong>일정 입력</strong>
              <span>{scheduleCopy.description}</span>
            </div>
            <div className={`roadmap-editor-assessment-grid ${hasMultiplePeriods ? 'is-multi-period' : ''}`.trim()}>
              {hasMultiplePeriods ? (
                <label className="academic-field roadmap-editor-field roadmap-editor-field-period">
                  <span>시기</span>
                  <select
                    className="styled-input"
                    value={editorDraft.activePeriodCode || activeEditor.period?.code || ''}
                    onChange={(event) => onChangeSchoolPeriod(event.target.value)}
                  >
                    {activeEditor.periodOptions.map((period) => (
                      <option key={period.code} value={period.code}>{period.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="academic-field roadmap-editor-field">
                <span>일정 종류</span>
                <select
                  className="styled-input"
                  value={scheduleEventType}
                  onChange={(event) => onChangeScheduleEventType(event.target.value)}
                  data-testid="roadmap-schedule-type-select"
                >
                  {scheduleTypeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="academic-field roadmap-editor-field">
                <span>{scheduleCopy.startLabel}</span>
                <input
                  type="date"
                  className="styled-input"
                  value={editorDraft.examStart || ''}
                  onChange={(event) => onChangeExamRange({ examStart: event.target.value })}
                />
              </label>
              <label className="academic-field roadmap-editor-field">
                <span>{scheduleCopy.endLabel}</span>
                <input
                  type="date"
                  className="styled-input"
                  value={editorDraft.examEnd || ''}
                  onChange={(event) => onChangeExamRange({ examEnd: event.target.value })}
                />
              </label>
            </div>
          </section>
        ) : null}

        <section className="roadmap-editor-split-card">
          <div className="roadmap-editor-split-head">
            <strong>{activeEditor.tab === 'school' ? '교재·시험범위 입력' : '교재·진도 입력'}</strong>
            <span>교과서, 부교재, 기타 자료를 셀 단위로 정리합니다.</span>
          </div>

          {MATERIAL_SECTION_DEFINITIONS.map((section) => (
            <section key={section.key} className="roadmap-editor-section">
              <div className="roadmap-editor-section-title">{section.label}</div>
              <MaterialRowsEditorCompact
                rows={editorDraft.rowsByCategory[section.key]}
                detailLabel={activeEditor.detailLabel}
                titleSuggestions={textbookSuggestions}
                onChangeRow={(rowIndex, patch) => onChangeRow(section.key, rowIndex, patch)}
                onAddRow={() => onAddRow(section.key)}
                onRemoveRow={(rowIndex) => onRemoveRow(section.key, rowIndex)}
              />
            </section>
          ))}

          <label className="academic-field roadmap-editor-note">
            <span>메모</span>
            <textarea
              className="styled-input"
              value={editorDraft.note}
              onChange={(event) => onChangeNote(event.target.value)}
              placeholder="셀 전체에 남길 메모가 있으면 적어 주세요."
              style={{ minHeight: 88, resize: 'vertical' }}
            />
          </label>
        </section>
      </div>
    </div>
  );
}

function RoadmapCellEditorMobileSheet({
  activeEditor,
  editorDraft,
  textbookSuggestions,
  isSaving,
  onClose,
  onChangeSchoolPeriod,
  onChangeScheduleEventType,
  onChangeNote,
  onChangeExamRange,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  onSave,
  scheduleTypeOptions = [],
}) {
  if (!activeEditor || !editorDraft) {
    return null;
  }

  const hasMultiplePeriods =
    activeEditor.tab === 'school' &&
    Array.isArray(activeEditor.periodOptions) &&
    activeEditor.periodOptions.length > 1;
  const scheduleEventType = text(editorDraft.scheduleEventType) || scheduleTypeOptions[0] || '시험기간';
  const scheduleCopy = getRoadmapScheduleEditorCopy(scheduleEventType);

  return (
    <BottomSheet
      open={Boolean(activeEditor)}
      onClose={onClose}
      title={activeEditor.title}
      subtitle={activeEditor.subtitle}
      maxWidth={720}
      fullHeightOnMobile
      testId="roadmap-editor-sheet"
      actions={(
        <div className="roadmap-editor-sheet-actions">
          <button type="button" className="action-chip" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="action-pill" onClick={onSave} disabled={isSaving}>
            <Save size={16} />
            저장
          </button>
        </div>
      )}
    >
      <div className="roadmap-editor-sheet">
        <div className="roadmap-cell-editor-eyebrow">{activeEditor.eyebrow}</div>
        <div className="roadmap-editor-context-card" data-testid="roadmap-editor-context-card">
          <div className="roadmap-editor-context-head">
            <strong>{activeEditor.title}</strong>
            <span>{activeEditor.detailLabel}</span>
          </div>
          <div className="roadmap-editor-context-chips">
            <span className="roadmap-mobile-summary-chip">{activeEditor.tab === 'school' ? '학교 기준' : '학원 기준'}</span>
            {activeEditor.period?.label ? (
              <span className="roadmap-mobile-summary-chip">{activeEditor.period.label}</span>
            ) : null}
          </div>
        </div>

        {activeEditor.tab === 'school' ? (
          <section className="roadmap-editor-split-card">
            <div className="roadmap-editor-split-head">
              <strong>일정 입력</strong>
              <span>{scheduleCopy.description}</span>
            </div>
            <div className={`roadmap-editor-assessment-grid ${hasMultiplePeriods ? 'is-multi-period' : ''}`.trim()}>
              {hasMultiplePeriods ? (
                <label className="academic-field roadmap-editor-field roadmap-editor-field-period">
                  <span>시기</span>
                  <select
                    className="styled-input"
                    value={editorDraft.activePeriodCode || activeEditor.period?.code || ''}
                    onChange={(event) => onChangeSchoolPeriod(event.target.value)}
                  >
                    {activeEditor.periodOptions.map((period) => (
                      <option key={period.code} value={period.code}>{period.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="academic-field roadmap-editor-field">
                <span>일정 종류</span>
                <select
                  className="styled-input"
                  value={scheduleEventType}
                  onChange={(event) => onChangeScheduleEventType(event.target.value)}
                  data-testid="roadmap-schedule-type-select"
                >
                  {scheduleTypeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="academic-field roadmap-editor-field">
                <span>{scheduleCopy.startLabel}</span>
                <input
                  type="date"
                  className="styled-input"
                  value={editorDraft.examStart || ''}
                  onChange={(event) => onChangeExamRange({ examStart: event.target.value })}
                />
              </label>
              <label className="academic-field roadmap-editor-field">
                <span>{scheduleCopy.endLabel}</span>
                <input
                  type="date"
                  className="styled-input"
                  value={editorDraft.examEnd || ''}
                  onChange={(event) => onChangeExamRange({ examEnd: event.target.value })}
                />
              </label>
            </div>
          </section>
        ) : null}

        <section className="roadmap-editor-split-card">
          <div className="roadmap-editor-split-head">
            <strong>{activeEditor.tab === 'school' ? '교재·시험범위 입력' : '교재·진도 입력'}</strong>
            <span>교과서, 부교재, 기타 자료를 섹션별로 정리해 둘 수 있습니다.</span>
          </div>

          {MATERIAL_SECTION_DEFINITIONS.map((section) => (
            <section key={section.key} className="roadmap-editor-section">
              <div className="roadmap-editor-section-title">{section.label}</div>
              <MaterialRowsEditorCompact
                rows={editorDraft.rowsByCategory?.[section.key] || []}
                detailLabel={activeEditor.detailLabel}
                titleSuggestions={textbookSuggestions}
                onChangeRow={(rowIndex, patch) => onChangeRow(section.key, rowIndex, patch)}
                onAddRow={() => onAddRow(section.key)}
                onRemoveRow={(rowIndex) => onRemoveRow(section.key, rowIndex)}
              />
            </section>
          ))}

          <label className="academic-field roadmap-editor-note">
            <span>메모</span>
            <textarea
              className="styled-input"
              value={editorDraft.note || ''}
              onChange={(event) => onChangeNote(event.target.value)}
              placeholder="추가로 남겨둘 메모가 있으면 입력해 주세요."
              style={{ minHeight: 88, resize: 'vertical' }}
            />
          </label>
        </section>
      </div>
    </BottomSheet>
  );
}

function RoadmapCell({ cell, onClick, disabled = false, testId = '', actions = null, highlighted = false }) {
  const sections = (cell.sections || []).map((section, index) => ({
    key: section.key || `${index}`,
    label: section.label || '',
    note: section.note || '',
    assessmentLines: section.assessmentLines || [],
    itemsByCategory: section.itemsByCategory || {
      textbook: [],
      supplement: [],
      other: [],
    },
  }));

  const hasContent = sections.some((section) =>
    section.assessmentLines.length > 0 ||
    text(section.note) ||
    Object.values(section.itemsByCategory).some((items) => (items || []).length > 0)
  );

  const content = (
    <div className="roadmap-cell-stack">
      {!hasContent ? (
        <div className="roadmap-cell-empty">클릭해서 입력</div>
      ) : (
        sections.map((section) => {
          const blocks = MATERIAL_SECTION_DEFINITIONS.map((materialSection) => ({
            ...materialSection,
            items: section.itemsByCategory[materialSection.key] || [],
          })).filter((materialSection) => materialSection.items.length > 0);

          return (
            <div key={section.key} className="roadmap-cell-group">
              {section.label ? <div className="roadmap-cell-group-label">{section.label}</div> : null}
              {section.assessmentLines.length > 0 ? (
                <div className="roadmap-cell-assessment">
                  {section.assessmentLines.map((line) => (
                    <div key={line} className="roadmap-cell-assessment-line">{line}</div>
                  ))}
                </div>
              ) : null}
              {blocks.map((materialSection) => (
                <div key={`${section.key}-${materialSection.key}`} className="roadmap-cell-block">
                  <span className="roadmap-cell-block-label">{materialSection.label}</span>
                  {materialSection.items.map((item) => (
                    <div key={item.id} className="roadmap-cell-line">
                      <strong>{formatItemLabel(item)}</strong>
                      {text(item.detail) ? <div className="roadmap-cell-detail">{item.detail}</div> : null}
                    </div>
                  ))}
                </div>
              ))}
              {text(section.note) ? <div className="roadmap-cell-note">{section.note}</div> : null}
            </div>
          );
        })
      )}
    </div>
  );

  const body = disabled || !onClick ? (
    <div className={`roadmap-cell-static ${highlighted ? 'is-linked-focus' : ''}`.trim()}>{content}</div>
  ) : (
    <button
      type="button"
      className={`roadmap-cell-button ${highlighted ? 'is-linked-focus' : ''}`.trim()}
      onClick={onClick}
      data-testid={testId || undefined}
    >
      {content}
    </button>
  );

  if (!actions) {
    return body;
  }

  return (
    <div className="roadmap-cell-shell">
      <div className="roadmap-cell-head">
        <div className="roadmap-cell-head-actions">{actions}</div>
      </div>
      {body}
    </div>
  );
}

export default function CurriculumRoadmapView({
  data = {},
  dataService = sharedDataService,
  navigationIntent = null,
  onOpenAcademicCalendar,
  embeddedMode = null,
}) {
  const toast = useToast();
  const { isStaff, isTeacher } = useAuth();
  const { isMobile } = useViewport();
  const { confirm, dialogProps } = useConfirmDialog();
  const canEdit = isStaff || isTeacher;
  const reportRef = useRef(null);
  const editorRef = useRef(null);
  const migrationAttemptedRef = useRef(false);

  const yearOptions = useMemo(() => buildYearOptions(data), [data]);
  const subjectOptions = useMemo(() => buildSubjectOptions(data), [data]);
  const schoolCatalog = useMemo(
    () => buildSchoolMaster(data.academicSchools || [], data.students || []),
    [data.academicSchools, data.students]
  );
  const subjectFilterOptions = useMemo(
    () => subjectOptions.map((subject) => ({ value: subject, label: subject })),
    [subjectOptions]
  );

  const [activeTab, setActiveTab] = useState('school');
  const [selectedYear, setSelectedYear] = useState(yearOptions[0] || new Date().getFullYear());
  const [selectedSubject, setSelectedSubject] = useState(subjectOptions[0] || SUBJECT_OPTIONS_KO[0]);
  const [selectedSchoolCategory, setSelectedSchoolCategory] = useState('all');
  const [selectedSchoolKeys, setSelectedSchoolKeys] = useState([]);
  const [selectedSchoolGrades, setSelectedSchoolGrades] = useState([]);
  const [selectedSchoolPeriods, setSelectedSchoolPeriods] = useState([]);
  const [schoolViewPreset, setSchoolViewPreset] = useState('school-annual-board');
  const [selectedAcademyGrade, setSelectedAcademyGrade] = useState(ALL_ACADEMY_GRADES);
  const [selectedAcademyClass, setSelectedAcademyClass] = useState(ALL_CLASSES);
  const [selectedAcademyPeriod, setSelectedAcademyPeriod] = useState(ALL_PERIODS);
  const [academyViewPreset, setAcademyViewPreset] = useState('class-by-period');
  const [academyScopeMode, setAcademyScopeMode] = useState('priority');
  const [customPeriodLabel, setCustomPeriodLabel] = useState('');
  const [roadmapSupport, setRoadmapSupport] = useState({ ready: true, missingTables: [] });
  const [isCheckingSupport, setIsCheckingSupport] = useState(true);
  const [activeEditor, setActiveEditor] = useState(null);
  const [editorDraft, setEditorDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false);
  const [visibleScheduleColumnKeys, setVisibleScheduleColumnKeys] = useState(
    ROADMAP_SCHEDULE_COLUMN_OPTIONS.map((column) => column.key)
  );
  const [hidePastLinkedEvents, setHidePastLinkedEvents] = useState(false);
  const [calendarEventPicker, setCalendarEventPicker] = useState(null);
  const [focusedLinkedTarget, setFocusedLinkedTarget] = useState(null);
  const isEmbeddedSchoolAnnualBoard = embeddedMode === 'school-annual-board';

  useEffect(() => {
    let cancelled = false;
    setIsCheckingSupport(true);
    dataService.getCurriculumRoadmapSupport()
      .then((support) => {
        if (!cancelled) {
          setRoadmapSupport(support);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRoadmapSupport({
            ready: false,
            missingTables: ['교재·진도 테이블 확인 실패'],
            error,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingSupport(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataService]);

  useEffect(() => {
    if (!roadmapSupport.ready || migrationAttemptedRef.current) {
      return;
    }

    migrationAttemptedRef.current = true;
    dataService.migrateLegacyCurriculumRoadmap(data)
      .then((result) => {
        if (result?.migrated) {
          toast.success('기존 교재 정보를 시기별 교재·진도 표로 옮겼습니다.');
        }
      })
      .catch((error) => {
        toast.error(`기존 교재 데이터 이관에 실패했습니다: ${getUserFriendlyDataError(error)}`);
      });
  }, [data, dataService, roadmapSupport.ready, toast]);

  useEffect(() => {
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0] || new Date().getFullYear());
    }
  }, [selectedYear, yearOptions]);

  useEffect(() => {
    if (activeTab === 'school' && schoolViewPreset !== 'school-annual-board') {
      setSchoolViewPreset('school-annual-board');
    }
  }, [activeTab, schoolViewPreset]);

  useEffect(() => {
    if (!isEmbeddedSchoolAnnualBoard) {
      return;
    }
    if (activeTab !== 'school') {
      setActiveTab('school');
    }
    if (schoolViewPreset !== 'school-annual-board') {
      setSchoolViewPreset('school-annual-board');
    }
  }, [activeTab, isEmbeddedSchoolAnnualBoard, schoolViewPreset]);

  useEffect(() => {
    if (selectedSubject !== ALL_SUBJECTS && !subjectOptions.includes(selectedSubject)) {
      setSelectedSubject(subjectOptions[0] || SUBJECT_OPTIONS_KO[0]);
    }
  }, [selectedSubject, subjectOptions]);

  useEffect(() => {
    if (!navigationIntent) {
      return;
    }

    const nextYear = Number(navigationIntent.academicYear || 0);
    if (nextYear) {
      setSelectedYear(nextYear);
    }

    const nextSubject = text(navigationIntent.subject);
    if (nextSubject) {
      setSelectedSubject(nextSubject);
    }

    const nextSchoolCategory = text(
      navigationIntent.schoolCategory ||
      (
        text(navigationIntent.grade)
          ? inferSchoolCategoryFromGrade(text(navigationIntent.grade))
          : ''
      )
    );

    if (navigationIntent.tab && !isEmbeddedSchoolAnnualBoard) {
      setActiveTab(navigationIntent.tab);
    }
    if (navigationIntent.tab === 'school' || isEmbeddedSchoolAnnualBoard) {
      setSchoolViewPreset('school-annual-board');
      setSelectedSchoolCategory(nextSchoolCategory || 'all');
      setSelectedSchoolKeys([]);
      setSelectedSchoolGrades([]);
      setSelectedSchoolPeriods([]);
    }
    setFocusedLinkedTarget({
      focusTarget: navigationIntent.focusTarget || 'grade-cell',
      schoolId: text(navigationIntent.schoolId),
      schoolKey: text(navigationIntent.schoolKey),
      grade: text(navigationIntent.grade),
      scheduleColumnKey: text(navigationIntent.scheduleColumnKey),
      eventId: text(navigationIntent.eventId),
      nonce: navigationIntent.nonce || Date.now(),
    });
  }, [isEmbeddedSchoolAnnualBoard, navigationIntent, schoolCatalog]);

  const textbookSuggestions = useMemo(
    () => [...new Set((data.textbooks || []).map((item) => text(item.title)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ko')),
    [data.textbooks]
  );

  const schoolOptions = useMemo(() => (
    schoolCatalog.filter((school) => selectedSchoolCategory === 'all' || school.category === selectedSchoolCategory)
  ), [schoolCatalog, selectedSchoolCategory]);

  const selectedSchools = useMemo(() => {
    const normalizedKeys = normalizeSelectionValues(selectedSchoolKeys);
    if (normalizedKeys.length === 0) {
      return schoolOptions;
    }
    return schoolOptions.filter((school) => normalizedKeys.includes(schoolKey(school.name)));
  }, [schoolOptions, selectedSchoolKeys]);

  const schoolGradeOptions = useMemo(() => {
    const baseSchools = selectedSchools.length > 0 ? selectedSchools : schoolOptions;
    const gradeSet = new Set();

    baseSchools.forEach((school) => {
      const nextGrades = school.grades.length > 0
        ? school.grades
        : getGradesForSchoolCategory(school.category);
      nextGrades.forEach((grade) => gradeSet.add(grade));
    });

    return [...gradeSet].sort((left, right) => gradeSort(left) - gradeSort(right) || left.localeCompare(right, 'ko'));
  }, [schoolOptions, selectedSchools]);

  const schoolPeriodOptions = useMemo(() => {
    if ((selectedSchoolPeriods || []).length === 0) {
      return FIXED_PERIODS_KO;
    }
    return FIXED_PERIODS_KO.filter((period) => selectedSchoolPeriods.includes(period.code));
  }, [selectedSchoolPeriods]);

  const visibleScheduleColumnOptions = useMemo(
    () => ROADMAP_SCHEDULE_COLUMN_OPTIONS.filter((column) => visibleScheduleColumnKeys.includes(column.key)),
    [visibleScheduleColumnKeys]
  );

  const filterLinkedRoadmapEvents = (events = []) => (
    (events || [])
      .filter((event) => !hidePastLinkedEvents || !isPastRoadmapLinkedEvent(event))
      .sort(compareRoadmapLinkedEvents)
  );

  const buildAcademicCalendarIntentFromLinkedEvent = (event, context = {}) => ({
    eventId: text(event?.id),
    eventType: text(event?.type),
    date: text(event?.start),
    schoolId: text(context.schoolId || event?.schoolId),
    schoolKey: text(context.schoolKey || schoolKey(context.schoolName || event?.schoolName)),
    schoolName: text(context.schoolName || event?.schoolName),
    schoolCategory: text(context.schoolCategory || ''),
    grade: text(context.grade || event?.gradeValues?.[0] || event?.grade),
  });

  const openAcademicCalendarForLinkedEvents = (events = [], context = {}) => {
    const filteredEvents = filterLinkedRoadmapEvents(events);
    if (filteredEvents.length === 0 || typeof onOpenAcademicCalendar !== 'function') {
      return;
    }
    if (filteredEvents.length === 1) {
      onOpenAcademicCalendar(buildAcademicCalendarIntentFromLinkedEvent(filteredEvents[0], context));
      return;
    }
    setCalendarEventPicker({
      title: context.title || '연결된 학사일정',
      subtitle: context.subtitle || '열어볼 일정을 선택해 주세요.',
      events: filteredEvents,
      context,
    });
  };

  const isFocusedGradeCell = (school, grade) => (
    focusedLinkedTarget?.focusTarget === 'grade-cell' &&
    (text(focusedLinkedTarget.schoolId) === text(school.id) || text(focusedLinkedTarget.schoolKey) === schoolKey(school.name)) &&
    text(focusedLinkedTarget.grade) === text(grade)
  );

  const isFocusedScheduleCell = (school, columnKey) => (
    focusedLinkedTarget?.focusTarget === 'schedule-column' &&
    (text(focusedLinkedTarget.schoolId) === text(school.id) || text(focusedLinkedTarget.schoolKey) === schoolKey(school.name)) &&
    text(focusedLinkedTarget.scheduleColumnKey) === text(columnKey)
  );

  const schoolRows = useMemo(() => {
    const rows = [];
    const baseSchools = selectedSchools.length > 0 ? selectedSchools : schoolOptions;
    baseSchools.forEach((school) => {
      const grades = (selectedSchoolGrades || []).length > 0
        ? selectedSchoolGrades
        : (school.grades.length > 0 ? school.grades : getGradesForSchoolCategory(school.category));
      grades.forEach((grade) => {
        if (text(grade)) {
          rows.push({
            id: `${school.id || schoolKey(school.name)}::${grade}`,
            school,
            grade,
          });
        }
      });
    });
    return rows;
  }, [schoolOptions, selectedSchoolGrades, selectedSchools]);

  const schoolPlans = useMemo(() => (
    (data.academicExamMaterialPlans || []).filter(
      (plan) => Number(plan.academicYear) === Number(selectedYear) && matchesSelectedSubject(plan.subject, selectedSubject)
    )
  ), [data.academicExamMaterialPlans, selectedSubject, selectedYear]);

  const schoolPlansByKey = useMemo(() => {
    const map = new Map();
    schoolPlans.forEach((plan) => {
      const key = `${plan.schoolId}::${plan.grade}::${plan.examPeriodCode}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(plan);
    });
    return map;
  }, [schoolPlans]);

  const schoolItemsByPlanId = useMemo(() => {
    const map = new Map();
    (data.academicExamMaterialItems || []).forEach((item) => {
      if (!map.has(item.planId)) {
        map.set(item.planId, []);
      }
      map.get(item.planId).push(item);
    });
    map.forEach((items) => items.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)));
    return map;
  }, [data.academicExamMaterialItems]);

  const schoolAssessmentByKey = useMemo(
    () => buildStructuredSchoolAssessmentLookup(data.academicEvents || [], selectedSubject),
    [data.academicEvents, selectedSubject]
  );

  const schoolScheduleBySchool = useMemo(
    () => buildStructuredScheduleEventsBySchool(data.academicEvents || [], ROADMAP_SCHEDULE_COLUMN_OPTIONS, selectedYear),
    [data.academicEvents, selectedYear]
  );

  const selectedSchoolGradeColumns = useMemo(() => {
    if ((selectedSchoolGrades || []).length > 0) {
      return [...selectedSchoolGrades].sort((left, right) => gradeSort(left) - gradeSort(right) || left.localeCompare(right, 'ko'));
    }

    const gradeSet = new Set();
    const baseSchools = selectedSchools.length > 0 ? selectedSchools : schoolOptions;
    baseSchools.forEach((school) => {
      const nextGrades = school.grades.length > 0
        ? school.grades
        : getGradesForSchoolCategory(school.category);
      nextGrades.forEach((grade) => gradeSet.add(grade));
    });

    return [...gradeSet].sort((left, right) => gradeSort(left) - gradeSort(right) || left.localeCompare(right, 'ko'));
  }, [schoolOptions, selectedSchoolGrades, selectedSchools]);

  const academyGradeOptions = useMemo(() => {
    const available = new Set(
      [
        ...(data.classes || []).map((item) => text(item.grade)),
        ...(data.academyCurriculumPeriodPlans || []).map((item) => text(item.academyGrade)),
        ...(data.academyCurriculumPeriodCatalogs || []).map((item) => text(item.academyGrade)),
        ...(data.academyCurriculumPlans || []).map((item) => normalizeAcademyGradeLabel(item.academyGrade)),
      ].filter(Boolean)
    );
    return getAllManagedGrades().filter((grade) => available.has(grade));
  }, [data.academyCurriculumPeriodCatalogs, data.academyCurriculumPeriodPlans, data.academyCurriculumPlans, data.classes]);

  const academyClassOptions = useMemo(() => (
    (data.classes || [])
      .filter((item) => matchesSelectedSubject(item.subject, selectedSubject))
      .filter((item) => selectedAcademyGrade === ALL_ACADEMY_GRADES || text(item.grade) === selectedAcademyGrade)
      .map((item) => ({
        id: item.id,
        label: item.className || item.name || '이름 없는 수업',
        grade: text(item.grade),
      }))
      .sort((left, right) => gradeSort(left.grade) - gradeSort(right.grade) || left.label.localeCompare(right.label, 'ko'))
  ), [data.classes, selectedAcademyGrade, selectedSubject]);

  useEffect(() => {
    setSelectedSchoolKeys((current) =>
      normalizeSelectionValues(current).filter((value) => schoolOptions.some((school) => schoolKey(school.name) === value))
    );
  }, [schoolOptions]);

  useEffect(() => {
    setSelectedSchoolGrades((current) =>
      normalizeSelectionValues(current).filter((value) => schoolGradeOptions.includes(value))
    );
  }, [schoolGradeOptions]);

  useEffect(() => {
    setSelectedSchoolPeriods((current) =>
      normalizeSelectionValues(current).filter((value) => FIXED_PERIODS_KO.some((period) => period.code === value))
    );
  }, []);

  useEffect(() => {
    if (selectedAcademyGrade !== ALL_ACADEMY_GRADES && !academyGradeOptions.includes(selectedAcademyGrade)) {
      setSelectedAcademyGrade(ALL_ACADEMY_GRADES);
    }
  }, [academyGradeOptions, selectedAcademyGrade]);

  useEffect(() => {
    if (selectedAcademyClass !== ALL_CLASSES && !academyClassOptions.some((item) => item.id === selectedAcademyClass)) {
      setSelectedAcademyClass(ALL_CLASSES);
    }
  }, [academyClassOptions, selectedAcademyClass]);

  const academyCatalogs = useMemo(() => (
    (data.academyCurriculumPeriodCatalogs || []).filter(
      (item) =>
        Number(item.academicYear) === Number(selectedYear) &&
        text(item.subject) === selectedSubject &&
        (selectedAcademyGrade === ALL_ACADEMY_GRADES || item.academyGrade === selectedAcademyGrade)
    )
  ), [data.academyCurriculumPeriodCatalogs, selectedAcademyGrade, selectedSubject, selectedYear]);

  const academyPlans = useMemo(() => (
    (data.academyCurriculumPeriodPlans || []).filter(
      (item) =>
        Number(item.academicYear) === Number(selectedYear) &&
        text(item.subject) === selectedSubject &&
        (selectedAcademyGrade === ALL_ACADEMY_GRADES || item.academyGrade === selectedAcademyGrade)
    )
  ), [data.academyCurriculumPeriodPlans, selectedAcademyGrade, selectedSubject, selectedYear]);

  const academyPlanByKey = useMemo(() => {
    const map = new Map();
    academyPlans.forEach((plan) => {
      map.set(`${plan.academyGrade}::${plan.scopeType}::${plan.classId || ''}::${plan.periodCode}`, plan);
    });
    return map;
  }, [academyPlans]);

  const academyItemsByPlanId = useMemo(() => {
    const map = new Map();
    (data.academyCurriculumPeriodItems || []).forEach((item) => {
      if (!map.has(item.planId)) {
        map.set(item.planId, []);
      }
      map.get(item.planId).push(item);
    });
    map.forEach((items) => items.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)));
    return map;
  }, [data.academyCurriculumPeriodItems]);

  const academyPeriodOptions = useMemo(() => {
    const customMap = new Map();
    academyCatalogs.forEach((catalog) => {
      customMap.set(catalog.periodCode, {
        code: catalog.periodCode,
        label: catalog.periodLabel,
        sortOrder: 100 + (catalog.sortOrder ?? 0),
        periodType: 'custom',
        catalogId: catalog.id,
      });
    });
    academyPlans.filter((plan) => plan.periodType === 'custom').forEach((plan) => {
      if (!customMap.has(plan.periodCode)) {
        customMap.set(plan.periodCode, {
          code: plan.periodCode,
          label: plan.periodLabel,
          sortOrder: 100 + (plan.sortOrder ?? 0),
          periodType: 'custom',
          catalogId: plan.catalogId || '',
        });
      }
    });

    const merged = [
      ...FIXED_PERIODS_KO,
      ...[...customMap.values()].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.label.localeCompare(right.label, 'ko')),
    ];
    if (selectedAcademyPeriod === ALL_PERIODS) {
      return merged;
    }
    return merged.filter((period) => period.code === selectedAcademyPeriod);
  }, [academyCatalogs, academyPlans, selectedAcademyPeriod]);

  const academyRows = useMemo(() => {
    if (selectedAcademyClass !== ALL_CLASSES) {
      const matchedClass = academyClassOptions.find((item) => item.id === selectedAcademyClass);
      return matchedClass ? [{
        id: `class::${matchedClass.id}`,
        label: matchedClass.label,
        academyGrade: matchedClass.grade,
        scopeType: 'class',
        classId: matchedClass.id,
      }] : [];
    }

    if (academyScopeMode === 'template') {
      const grades = selectedAcademyGrade === ALL_ACADEMY_GRADES ? academyGradeOptions : [selectedAcademyGrade];
      return grades.filter(Boolean).map((grade) => ({
        id: `template::${grade}`,
        label: `${grade} 기본 운영안`,
        academyGrade: grade,
        scopeType: 'template',
        classId: '',
      }));
    }

    const classRows = academyClassOptions.map((item) => ({
      id: `class::${item.id}`,
      label: item.label,
      academyGrade: item.grade,
      scopeType: 'class',
      classId: item.id,
    }));

    if (academyScopeMode === 'class') {
      return classRows;
    }

    const templateGrades = new Set(
      academyPlans
        .filter((plan) => plan.scopeType === 'template')
        .map((plan) => plan.academyGrade)
    );

    const rows = [...classRows];
    if (rows.length === 0) {
      templateGrades.forEach((grade) => {
        rows.push({
          id: `template::${grade}`,
          label: `${grade} 기본 운영안`,
          academyGrade: grade,
          scopeType: 'template',
          classId: '',
        });
      });
    }
    return rows;
  }, [academyClassOptions, academyGradeOptions, academyPlans, academyScopeMode, selectedAcademyClass, selectedAcademyGrade]);

  const getPlansForSchoolSlot = (schoolId, grade, periodCode) => {
    if (!schoolId) {
      return [];
    }
    return schoolPlansByKey.get(`${schoolId}::${grade}::${periodCode}`) || [];
  };

  const buildSchoolCell = (school, grade, periods = schoolPeriodOptions) => {
    const sections = (periods || []).map((period) => {
      const plans = getPlansForSchoolSlot(school.id, grade, period.code);
      const items = plans.flatMap((plan) => schoolItemsByPlanId.get(plan.id) || []);
      const assessment = school.id ? schoolAssessmentByKey.get(buildSchoolAssessmentKey(school.id, selectedYear, grade, period.code)) : null;
      const linkedEvents = filterLinkedRoadmapEvents(assessment?.linkedEvents || []);
      return {
        key: `${grade}::${period.code}`,
        label: periods.length > 1 ? period.label : '',
        note: plans.map((plan) => text(plan?.note)).filter(Boolean).join('\n'),
        assessmentLines: linkedEvents.map((event) => event.summary),
        examStart: assessment?.examWindowStart || '',
        examEnd: assessment?.examWindowEnd || '',
        eventId: assessment?.eventId || '',
        linkedEvents,
        itemsByCategory: groupItemsByCategory(items, 'scopeDetail'),
      };
    });

    return {
      sections: sections.filter((section) =>
        section.assessmentLines.length > 0 ||
        text(section.note) ||
        Object.values(section.itemsByCategory).some((items) => (items || []).length > 0)
      ),
    };
  };

  const buildAcademyCell = (row, periods = academyPeriodOptions) => {
    const sections = (periods || []).map((period) => {
      const plan = academyPlanByKey.get(`${row.academyGrade}::${row.scopeType}::${row.classId || ''}::${period.code}`) || null;
      const items = plan ? academyItemsByPlanId.get(plan.id) || [] : [];
      return {
        key: `${buildAcademyStackKey(row)}::${period.code}`,
        label: periods.length > 1 ? period.label : '',
        note: plan?.note || '',
        assessmentLines: [],
        itemsByCategory: groupItemsByCategory(items, 'planDetail'),
      };
    });

    return {
      sections: sections.filter((section) =>
        text(section.note) ||
        Object.values(section.itemsByCategory).some((items) => (items || []).length > 0)
      ),
    };
  };

  const schoolBoardRows = useMemo(() => {
    const baseSchools = selectedSchools.length > 0 ? selectedSchools : schoolOptions;
    return baseSchools.map((school) => ({
      id: school.id || schoolKey(school.name),
      school,
      gradeCells: selectedSchoolGradeColumns.map((grade) => ({
        grade,
        cell: buildSchoolCell(school, grade, schoolPeriodOptions),
      })),
      scheduleGroups: visibleScheduleColumnOptions.map((column) => ({
        ...column,
        entries: filterLinkedRoadmapEvents(
          column.types.flatMap((type) => schoolScheduleBySchool.get(school.id)?.get(type) || [])
        ),
      })),
    }));
  }, [
    filterLinkedRoadmapEvents,
    schoolItemsByPlanId,
    schoolOptions,
    schoolPlansByKey,
    schoolScheduleBySchool,
    schoolAssessmentByKey,
    schoolPeriodOptions,
    selectedSchools,
    selectedSchoolGradeColumns,
    visibleScheduleColumnOptions,
  ]);

  const academyGroupedRows = useMemo(() => {
    if (academyViewPreset === 'class-by-period') {
      return academyRows.map((row) => ({
        id: row.id,
        label: row.label,
        subtitle: `${row.academyGrade} · ${row.scopeType === 'class' ? '실반' : '템플릿'}`,
        cells: academyPeriodOptions.map((period) => ({
          key: period.code,
          label: period.label,
          cell: buildAcademyCell(row, [period]),
          editable: true,
          row,
          period,
        })),
      }));
    }

    if (academyViewPreset === 'grade-by-period') {
      const gradeRows = selectedAcademyGrade === ALL_ACADEMY_GRADES ? academyGradeOptions : [selectedAcademyGrade];
      return gradeRows.filter(Boolean).map((grade) => ({
        id: `grade::${grade}`,
        label: grade,
        subtitle: '학년 묶음',
        cells: academyPeriodOptions.map((period) => {
          const rows = academyRows.filter((row) => row.academyGrade === grade);
          const sections = rows.reduce((accumulator, row) => {
            const baseSection = buildAcademyCell(row, [period]).sections[0];
            if (baseSection) {
              accumulator.push({
                ...baseSection,
                key: `${row.id}::${period.code}`,
                label: row.label,
              });
            }
            return accumulator;
          }, []);
          return {
            key: period.code,
            label: period.label,
            cell: { sections },
            editable: false,
          };
        }),
      }));
    }

    return academyPeriodOptions.map((period) => ({
      id: `period::${period.code}`,
      label: period.label,
      subtitle: '시기 묶음',
      cells: (selectedAcademyGrade === ALL_ACADEMY_GRADES ? academyGradeOptions : [selectedAcademyGrade])
        .filter(Boolean)
        .map((grade) => {
          const rows = academyRows.filter((row) => row.academyGrade === grade);
          const sections = rows.reduce((accumulator, row) => {
            const baseSection = buildAcademyCell(row, [period]).sections[0];
            if (baseSection) {
              accumulator.push({
                ...baseSection,
                key: `${row.id}::${period.code}`,
                label: row.label,
              });
            }
            return accumulator;
          }, []);
          return {
            key: grade,
            label: grade,
            cell: { sections },
            editable: false,
          };
        }),
    }));
  }, [academyRows, academyPeriodOptions, academyViewPreset, academyGradeOptions, selectedAcademyGrade, academyPlanByKey, academyItemsByPlanId]);

  const ensureSchoolRecord = async (school) => {
    if (school?.id) {
      return school;
    }
    const savedSchools = await dataService.upsertAcademicSchools([
      {
        id: school?.id || createId(),
        name: school?.name,
        category: school?.category || 'high',
        color: school?.color || '#216e4e',
        sortOrder: 0,
      },
    ]);
    return savedSchools[0] || school;
  };

  const closeEditor = () => {
    setActiveEditor(null);
    setEditorDraft(null);
  };

  const buildSchoolEditorDraft = (school, grade, periodCode, periodOptions, preferredEventType = '') => {
    const availablePeriods = Array.isArray(periodOptions) && periodOptions.length > 0 ? periodOptions : FIXED_PERIODS_KO;
    const currentPeriod = availablePeriods.find((item) => item.code === periodCode) || availablePeriods[0];
    const plans = school?.id ? getPlansForSchoolSlot(school.id, grade, currentPeriod?.code || '') : [];
    const plan = plans[0] || null;
    const items = plans.flatMap((item) => schoolItemsByPlanId.get(item.id) || []);
    const assessment = school?.id
      ? schoolAssessmentByKey.get(buildSchoolAssessmentKey(school.id, selectedYear, grade, currentPeriod?.code || ''))
      : null;
    const scheduleEventType = normalizeRoadmapEditorEventType(preferredEventType, selectedSubject);
    const linkedEvent = assessment?.eventMetaByType?.get(scheduleEventType) || null;

    return {
      planId: plan?.id || '',
      activePeriodCode: currentPeriod?.code || '',
      scheduleEventType,
      note: plans.map((item) => text(item?.note)).filter(Boolean).join('\n'),
      examStart: linkedEvent?.start || '',
      examEnd: linkedEvent?.end || linkedEvent?.start || '',
      linkedEventId: linkedEvent?.id || '',
      rowsByCategory: buildDraftRows(items, 'scopeDetail'),
    };
  };

  const syncSchoolEditorPeriod = (periodCode) => {
    setActiveEditor((current) => {
      if (!current || current.tab !== 'school') {
        return current;
      }
      const periodOptions = Array.isArray(current.periodOptions) && current.periodOptions.length > 0
        ? current.periodOptions
        : [current.period].filter(Boolean);
      const nextPeriod = periodOptions.find((item) => item.code === periodCode) || periodOptions[0] || current.period;
      setEditorDraft(buildSchoolEditorDraft(
        current.school,
        current.grade,
        nextPeriod?.code || '',
        periodOptions,
        editorDraft?.scheduleEventType,
      ));
      return {
        ...current,
        period: nextPeriod,
      };
    });
  };

  const syncSchoolEditorEventType = (nextEventType) => {
    setEditorDraft((current) => {
      if (!activeEditor || activeEditor.tab !== 'school' || !current) {
        return current;
      }
      const normalizedType = normalizeRoadmapEditorEventType(nextEventType, selectedSubject);
      const periodCode = current.activePeriodCode || activeEditor.period?.code || '';
      const assessment = activeEditor.school?.id
        ? schoolAssessmentByKey.get(buildSchoolAssessmentKey(activeEditor.school.id, selectedYear, activeEditor.grade, periodCode))
        : null;
      const linkedEvent = assessment?.eventMetaByType?.get(normalizedType) || null;
      return {
        ...current,
        scheduleEventType: normalizedType,
        examStart: linkedEvent?.start || current.examStart || '',
        examEnd: linkedEvent?.end || linkedEvent?.start || current.examEnd || current.examStart || '',
        linkedEventId: linkedEvent?.id || '',
      };
    });
  };

  useEffect(() => {
    if (!activeEditor || isMobile) {
      return undefined;
    }

    const handlePointer = (event) => {
      if (editorRef.current?.contains(event.target)) {
        return;
      }
      closeEditor();
    };

    document.addEventListener('mousedown', handlePointer, true);
    return () => document.removeEventListener('mousedown', handlePointer, true);
  }, [activeEditor, isMobile]);

  const openSchoolEditor = (row, period, target, options = {}) => {
    handleOpenSchoolEditor(row, period, target, options);
  };

  const handleOpenSchoolEditor = (row, period, target, options = {}) => {
    if (!canEditSchoolCells) {
      toast.error('학교 연간일정표 편집은 과목을 하나만 선택했을 때 가능합니다.');
      return;
    }
    const periodOptions = Array.isArray(options.periodOptions) && options.periodOptions.length > 0
      ? options.periodOptions
      : period
        ? [period]
        : (schoolPeriodOptions.length > 0 ? schoolPeriodOptions : FIXED_PERIODS_KO);
    const initialPeriod =
      periodOptions.find((item) => item.code === options.periodCode) ||
      period ||
      periodOptions[0] ||
      FIXED_PERIODS_KO[0];
    setActiveEditor({
      tab: 'school',
      school: row.school,
      grade: row.grade,
      period: initialPeriod,
      periodOptions,
      eyebrow: '학교 기준',
      title: `${row.school.name} · ${row.grade}`,
      subtitle: `${selectedYear}년 ${selectedSubjectLabel} · ${initialPeriod?.label || ''}`,
      detailLabel: '시험범위',
      noteLabel: '메모',
      anchor: buildEditorAnchor(target.getBoundingClientRect()),
    });
    setEditorDraft(buildSchoolEditorDraft(row.school, row.grade, initialPeriod?.code || '', periodOptions));
  };

  const openAcademyEditor = (row, period, target) => {
    const plan = academyPlanByKey.get(`${row.academyGrade}::${row.scopeType}::${row.classId || ''}::${period.code}`) || null;
    const items = plan ? academyItemsByPlanId.get(plan.id) || [] : [];
    setActiveEditor({
      tab: 'academy',
      row,
      period,
      planId: plan?.id || '',
      eyebrow: row.scopeType === 'class' ? '학원 기준 · 실반' : '학원 기준 · 템플릿',
      title: row.label,
      subtitle: `${selectedYear}년 ${selectedSubjectLabel} · ${period.label}`,
      detailLabel: '수업계획(진도)',
      noteLabel: '운영 메모',
      anchor: buildEditorAnchor(target.getBoundingClientRect()),
    });
    setEditorDraft({
      note: plan?.note || '',
      rowsByCategory: buildDraftRows(items, 'planDetail'),
    });
  };

  const updateEditorRow = (sectionKey, rowIndex, patch) => {
    setEditorDraft((current) => ({
      ...current,
      rowsByCategory: {
        ...current.rowsByCategory,
        [sectionKey]: current.rowsByCategory[sectionKey].map((row, index) => (
          index === rowIndex ? { ...row, ...patch } : row
        )),
      },
    }));
  };

  const addEditorRow = (sectionKey) => {
    setEditorDraft((current) => ({
      ...current,
      rowsByCategory: {
        ...current.rowsByCategory,
        [sectionKey]: [...current.rowsByCategory[sectionKey], createEmptyMaterial(sectionKey)],
      },
    }));
  };

  const removeEditorRow = (sectionKey, rowIndex) => {
    setEditorDraft((current) => {
      const nextRows = current.rowsByCategory[sectionKey].filter((_, index) => index !== rowIndex);
      return {
        ...current,
        rowsByCategory: {
          ...current.rowsByCategory,
          [sectionKey]: nextRows.length > 0 ? nextRows : [createEmptyMaterial(sectionKey)],
        },
      };
    });
  };

  const syncSchoolAssessmentEvent = async (school, grade, period, draft, fallbackSchool = null) => {
    const eventType = normalizeRoadmapEditorEventType(draft?.scheduleEventType, selectedSubject);
    const eventStart = text(draft?.examStart || draft?.examEnd);
    const eventEnd = text(draft?.examEnd || draft?.examStart);
    const schoolRecord = school?.id ? school : fallbackSchool;
    const currentAssessment = schoolRecord?.id
      ? schoolAssessmentByKey.get(buildSchoolAssessmentKey(schoolRecord.id, selectedYear, grade, period.code))
      : null;
    const existingEventId = text(
      draft?.linkedEventId ||
      currentAssessment?.eventMetaByType?.get(eventType)?.id ||
      (eventType === '시험기간' ? currentAssessment?.eventId : '')
    );

    if (!eventStart) {
      if (existingEventId) {
        await dataService.deleteAcademicEvent(existingEventId);
      }
      return;
    }

    const roadmapSubject = ROADMAP_EDITOR_EVENT_TYPE_BY_SUBJECT[selectedSubject] === eventType ? selectedSubject : '';
    const eventColor = ROADMAP_EVENT_COLOR_BY_TYPE[eventType] || '#2f6f63';
    const roadmapMeta = {
      academicYear: Number(selectedYear) || new Date().getFullYear(),
      roadmapPeriodCode: period.code,
      roadmapSubject,
      roadmapSync: {
        source: 'curriculum-roadmap',
        kind: 'schedule-event',
        eventType,
        academicYear: Number(selectedYear) || new Date().getFullYear(),
        schoolId: schoolRecord?.id || '',
        grade,
        periodCode: period.code,
        subject: roadmapSubject,
      },
    };

    await dataService.bulkUpsertAcademicEvents([{
      id: existingEventId || createId(),
      title: buildRoadmapScheduleEventTitle(schoolRecord?.name || school?.name || '', period.label, eventType),
      school: schoolRecord?.name || school?.name || '',
      schoolId: schoolRecord?.id || school?.id || null,
      type: eventType,
      start: eventStart,
      end: eventEnd,
      grade,
      color: eventColor,
      note: mergeEmbeddedNoteMeta('', roadmapMeta),
    }]);
  };

  const saveActiveEditor = async () => {
    if (!activeEditor || !editorDraft) {
      return;
    }

    setIsSaving(true);
    try {
      const rows = flattenDraftRows(editorDraft.rowsByCategory);
      const hasPayload = rows.length > 0 || text(editorDraft.note);
      const hasAssessmentPayload = activeEditor.tab === 'school'
        && (text(editorDraft.examStart) || text(editorDraft.examEnd) || text(editorDraft.linkedEventId));
      const activeSchoolPeriod = activeEditor.tab === 'school'
        ? (activeEditor.periodOptions?.find((item) => item.code === editorDraft.activePeriodCode) || activeEditor.period)
        : null;

      if (activeEditor.tab === 'school') {
        let savedSchool = activeEditor.school;
        if ((hasPayload || hasAssessmentPayload) && !savedSchool?.id) {
          savedSchool = await ensureSchoolRecord(activeEditor.school);
        }
        if (!hasPayload) {
          if (editorDraft.planId) {
            await dataService.deleteAcademicExamMaterialPlan(editorDraft.planId);
          }
        } else {
          const [savedPlan] = await dataService.bulkUpsertAcademicExamMaterialPlans([{
            id: editorDraft.planId || createId(),
            academicYear: selectedYear,
            subject: selectedSubject,
            schoolId: savedSchool.id,
            grade: activeEditor.grade,
            examPeriodCode: activeSchoolPeriod.code,
            note: editorDraft.note,
            sortOrder: activeSchoolPeriod.sortOrder,
          }]);
          await dataService.replaceAcademicExamMaterialItems(savedPlan.id, rows.map((item) => ({
            id: item.id,
            materialCategory: item.materialCategory,
            title: item.title,
            publisher: item.publisher,
            scopeDetail: item.detail,
            note: item.note,
            sortOrder: item.sortOrder,
          })));
        }
        await syncSchoolAssessmentEvent(activeEditor.school, activeEditor.grade, activeSchoolPeriod, editorDraft, savedSchool);
      } else {
        if (!hasPayload) {
          if (activeEditor.planId) {
            await dataService.deleteAcademyCurriculumPeriodPlan(activeEditor.planId);
          }
        } else {
          const textbookByTitle = new Map((data.textbooks || []).map((item) => [text(item.title), item]));
          const [savedPlan] = await dataService.bulkUpsertAcademyCurriculumPeriodPlans([{
            id: activeEditor.planId || createId(),
            academicYear: selectedYear,
            subject: selectedSubject,
            academyGrade: activeEditor.row.academyGrade,
            catalogId: activeEditor.period.catalogId || null,
            periodType: activeEditor.period.periodType || 'fixed',
            periodCode: activeEditor.period.code,
            periodLabel: activeEditor.period.label,
            scopeType: activeEditor.row.scopeType,
            classId: activeEditor.row.classId || null,
            note: editorDraft.note,
            sortOrder: activeEditor.period.sortOrder,
          }]);
          await dataService.replaceAcademyCurriculumPeriodItems(savedPlan.id, rows.map((item) => ({
            id: item.id,
            materialCategory: item.materialCategory,
            textbookId: textbookByTitle.get(item.title)?.id || null,
            title: item.title,
            publisher: item.publisher,
            planDetail: item.detail,
            note: item.note,
            sortOrder: item.sortOrder,
          })));
        }
      }

      toast.success('교재·진도 셀을 저장했습니다.');
      closeEditor();
    } catch (error) {
      toast.error(`교재·진도 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const addCustomPeriod = async () => {
    if (!text(customPeriodLabel)) {
      toast.error('추가할 시기 이름을 입력해 주세요.');
      return;
    }
    if (selectedAcademyGrade === ALL_ACADEMY_GRADES) {
      toast.error('사용자 시기를 추가하려면 학원 학년을 먼저 선택해 주세요.');
      return;
    }

    try {
      await dataService.upsertAcademyCurriculumPeriodCatalogs([{
        id: createId(),
        academicYear: selectedYear,
        subject: selectedSubject,
        academyGrade: selectedAcademyGrade,
        periodCode: `custom-${Date.now()}`,
        periodLabel: text(customPeriodLabel),
        sortOrder: academyCatalogs.length + 10,
      }]);
      setCustomPeriodLabel('');
      toast.success('사용자 시기를 추가했습니다.');
    } catch (error) {
      toast.error(`시기 추가에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const renameCustomPeriod = async (period) => {
    const nextLabel = window.prompt('새 시기 이름을 입력해 주세요.', period.label);
    if (!nextLabel || text(nextLabel) === text(period.label)) {
      return;
    }
    try {
      await dataService.upsertAcademyCurriculumPeriodCatalogs([{
        id: period.catalogId,
        academicYear: selectedYear,
        subject: selectedSubject,
        academyGrade: selectedAcademyGrade,
        periodCode: period.code,
        periodLabel: text(nextLabel),
        sortOrder: period.sortOrder ?? 0,
      }]);
      const relatedPlans = academyPlans.filter((plan) => plan.catalogId === period.catalogId);
      if (relatedPlans.length > 0) {
        await dataService.bulkUpsertAcademyCurriculumPeriodPlans(
          relatedPlans.map((plan) => ({ ...plan, periodLabel: text(nextLabel) }))
        );
      }
      toast.success('사용자 시기 이름을 바꿨습니다.');
    } catch (error) {
      toast.error(`시기 이름 변경에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const deleteCustomPeriod = async (period) => {
    const approved = await confirm({
      title: '사용자 시기를 삭제할까요?',
      description: '연결된 학원 교재·진도 셀도 함께 삭제됩니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger',
    });
    if (!approved) {
      return;
    }
    try {
      await dataService.deleteAcademyCurriculumPeriodCatalog(period.catalogId);
      toast.success('사용자 시기를 삭제했습니다.');
    } catch (error) {
      toast.error(`시기 삭제에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const printReport = () => {
    if (!reportRef.current) {
      return;
    }
    const popup = window.open('', '_blank', 'width=1280,height=900');
    if (!popup) {
      toast.error('인쇄 창을 열 수 없습니다. 팝업 차단을 확인해 주세요.');
      return;
    }
    popup.document.open();
    popup.document.write(buildPrintHtml('교재·진도', reportRef.current.innerHTML));
    popup.document.close();
    popup.focus();
  };

  const activePresetOptions = ACADEMY_VIEW_PRESET_OPTIONS;
  const activePreset = academyViewPreset;
  const setActivePreset = setAcademyViewPreset;
  const activePresetLabel = activeTab === 'school'
    ? SCHOOL_ANNUAL_BOARD_LABEL
    : activePresetOptions.find((preset) => preset.value === activePreset)?.label || '';
  const selectedSubjectLabel = selectedSubject === ALL_SUBJECTS ? '전체 과목' : selectedSubject;
  const selectedSchoolCategoryLabel = SCHOOL_CATEGORY_FILTER_OPTIONS.find((option) => option.value === selectedSchoolCategory)?.label || '전체';
  const selectedSchoolScopeLabel = (selectedSchoolKeys || []).length === 0
    ? '전체 학교'
    : formatSelectionSummary(selectedSchools.map((school) => school.name), '전체 학교', '곳');
  const selectedSchoolGradeLabel = (selectedSchoolGrades || []).length === 0
    ? '전체 학년'
    : formatSelectionSummary(selectedSchoolGrades, '전체 학년');
  const selectedSchoolPeriodLabel = (selectedSchoolPeriods || []).length === 0
    ? '전체 시기'
    : formatSelectionSummary(
        selectedSchoolPeriods.map((periodCode) => FIXED_PERIODS_KO.find((period) => period.code === periodCode)?.label || periodCode),
        '전체 시기'
      );
  const selectedAcademyClassLabel = selectedAcademyClass === ALL_CLASSES
    ? '전체 수업'
    : academyClassOptions.find((item) => item.id === selectedAcademyClass)?.label || '선택 수업';
  const selectedAcademyPeriodLabel = selectedAcademyPeriod === ALL_PERIODS
    ? '전체 시기'
    : academyPeriodOptions.find((period) => period.code === selectedAcademyPeriod)?.label || selectedAcademyPeriod;
  const roadmapModeLabel = activeTab === 'school' ? '학교 기준' : '학원 기준';
  const roadmapScopeLabel = activeTab === 'school'
    ? selectedSchoolScopeLabel
    : selectedAcademyClassLabel;
  const roadmapSummaryTokens = activeTab === 'school'
    ? [
        selectedSchoolCategoryLabel,
        selectedSchoolScopeLabel,
        selectedSchoolGradeLabel,
        selectedSchoolPeriodLabel,
      ]
    : [
        selectedAcademyGrade === ALL_ACADEMY_GRADES ? '전체 학년' : selectedAcademyGrade,
        selectedAcademyClassLabel,
        selectedAcademyPeriodLabel,
      ];
  const roadmapSheetContextTokens = [`${selectedYear}년`, selectedSubjectLabel, activePresetLabel].filter(Boolean);
  const canEditSchoolCells = canEdit && selectedSubject !== ALL_SUBJECTS;
  const yearMenuOptions = yearOptions.map((year) => ({ value: String(year), label: `${year}년` }));
  const selectedSubjectValues = selectedSubject === ALL_SUBJECTS ? [] : [selectedSubject];
  const subjectSegmentItems = subjectOptions.map((subject) => ({
    value: subject,
    label: subject,
    testId: `roadmap-subject-segment-${subject}`,
  }));
  const schoolCategorySegmentItems = SCHOOL_CATEGORY_FILTER_OPTIONS
    .filter((option) => option.value !== 'all')
    .map((option) => ({
      value: option.value,
      label: option.label,
      testId: `roadmap-school-category-segment-${option.value}`,
    }));
  const showPastLinkedEvents = !hidePastLinkedEvents;
  const toggleScheduleColumn = (columnKey) => {
    setVisibleScheduleColumnKeys((current) => {
      const nextKeys = current.includes(columnKey)
        ? current.filter((value) => value !== columnKey)
        : [...current, columnKey];
      return ROADMAP_SCHEDULE_COLUMN_OPTIONS
        .map((column) => column.key)
        .filter((key) => nextKeys.includes(key));
    });
  };

  const roadmapFilterControls = (
    <>
      {activeTab === 'school' ? (
        <div className="roadmap-school-filter-panel" data-testid="roadmap-school-linked-filters">
          <div className="roadmap-school-filter-panel__row">
            <div className="roadmap-school-filter-item roadmap-school-filter-item--menu">
              <CheckboxMenu
                className="roadmap-school-filter-menu"
                label="연도 선택"
                value={[String(selectedYear)]}
                options={yearMenuOptions}
                selectionMode="single"
                placeholder="연도"
                clearLabel={`${yearOptions[0] || selectedYear}년`}
                clearDescription="기본 연도로 돌아갑니다."
                showCountMeta={false}
                onChange={(nextValues) => setSelectedYear(Number(nextValues[0] || yearOptions[0] || new Date().getFullYear()))}
              />
            </div>
            <div className="roadmap-school-filter-item roadmap-school-filter-segment">
              <SegmentedControl
                size="small"
                items={subjectSegmentItems}
                value={selectedSubject === ALL_SUBJECTS ? null : selectedSubject}
                onValueChange={(nextValue) => {
                  setSelectedSubject((current) => (current === nextValue ? ALL_SUBJECTS : nextValue));
                }}
              />
            </div>
            <div className="roadmap-school-filter-item roadmap-school-filter-segment">
              <SegmentedControl
                size="small"
                items={schoolCategorySegmentItems}
                value={selectedSchoolCategory === 'all' ? null : selectedSchoolCategory}
                onValueChange={(nextValue) => {
                  const nextCategory = selectedSchoolCategory === nextValue ? 'all' : nextValue;
                  setSelectedSchoolCategory(nextCategory);
                  setSelectedSchoolKeys([]);
                  setSelectedSchoolGrades([]);
                  setSelectedSchoolPeriods([]);
                }}
              />
            </div>
            {ROADMAP_SCHEDULE_COLUMN_OPTIONS.map((column) => {
              const active = visibleScheduleColumnKeys.includes(column.key);
              return (
                <div
                  key={column.key}
                  className="roadmap-school-filter-switch"
                  data-testid={`roadmap-event-filter-chip-${column.key}`}
                >
                  <div className="roadmap-school-filter-switch__copy">
                    <strong>{column.label}</strong>
                  </div>
                  <Switch
                    size="small"
                    checked={active}
                    label={column.label}
                    onChange={() => toggleScheduleColumn(column.key)}
                  />
                </div>
              );
            })}
            <div
              className="roadmap-school-filter-switch"
              data-testid="roadmap-hide-past-toggle"
            >
              <div className="roadmap-school-filter-switch__copy">
                <strong>지난 일정</strong>
              </div>
              <Switch
                size="small"
                checked={showPastLinkedEvents}
                label="지난 일정"
                onChange={(checked) => setHidePastLinkedEvents(!checked)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="roadmap-filter-grid">
          <label className="curriculum-filter-field">
            <span>연도</span>
            <CheckboxMenu
              className="roadmap-school-filter-menu"
              label="연도 선택"
              value={[String(selectedYear)]}
              options={yearMenuOptions}
              selectionMode="single"
              placeholder="연도 선택"
              clearLabel="기본 연도"
              clearDescription="가장 최근 연도로 돌아갑니다."
              showCountMeta={false}
              onChange={(nextValues) => setSelectedYear(Number(nextValues[0] || yearOptions[0] || new Date().getFullYear()))}
            />
          </label>
          <label className="curriculum-filter-field">
            <span>과목</span>
            <CheckboxMenu
              className="roadmap-school-filter-menu"
              label="과목 선택"
              value={selectedSubjectValues}
              options={subjectFilterOptions}
              selectionMode="single"
              placeholder="과목 선택"
              clearLabel="전체 과목"
              clearDescription="모든 과목 일정을 함께 보여줍니다."
              showCountMeta={false}
              onChange={(nextValues) => setSelectedSubject(nextValues[0] || ALL_SUBJECTS)}
            />
          </label>
          <label className="curriculum-filter-field">
            <span>학원 학년</span>
            <select className="styled-input" value={selectedAcademyGrade} onChange={(event) => { setSelectedAcademyGrade(event.target.value); setSelectedAcademyClass(ALL_CLASSES); }}>
              <option value={ALL_ACADEMY_GRADES}>전체 학년</option>
              {academyGradeOptions.map((grade) => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
          </label>
          <label className="curriculum-filter-field">
            <span>수업</span>
            <select className="styled-input" value={selectedAcademyClass} onChange={(event) => setSelectedAcademyClass(event.target.value)}>
              <option value={ALL_CLASSES}>전체 수업</option>
              {academyClassOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="curriculum-filter-field">
            <span>시기</span>
            <select className="styled-input" value={selectedAcademyPeriod} onChange={(event) => setSelectedAcademyPeriod(event.target.value)}>
              <option value={ALL_PERIODS}>전체 시기</option>
              {academyPeriodOptions.map((period) => (
                <option key={period.code} value={period.code}>{period.label}</option>
              ))}
            </select>
          </label>
          <label className="curriculum-filter-field">
            <span>표시 기준</span>
            <select className="styled-input" value={academyScopeMode} onChange={(event) => setAcademyScopeMode(event.target.value)}>
              <option value="priority">수업 우선</option>
              <option value="class">수업만</option>
              <option value="template">템플릿만</option>
            </select>
          </label>
        </div>
      )}

      {activeTab === 'academy' ? (
        <div className="roadmap-view-preset-row">
          <div className="roadmap-view-preset-group">
            <span className="roadmap-view-preset-label">보기 프리셋</span>
            {activePresetOptions.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`action-chip ${activePreset === preset.value ? 'active' : ''}`}
                onClick={() => setActivePreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === 'academy' ? (
        <div className="roadmap-custom-period-row">
          <label className="curriculum-filter-field roadmap-custom-period-field">
            <span>사용자 시기</span>
            <input
              className="styled-input"
              value={customPeriodLabel}
              onChange={(event) => setCustomPeriodLabel(event.target.value)}
              placeholder="예: 봄방학 특강"
              disabled={!canEdit}
            />
          </label>
          <button type="button" className="action-chip" onClick={addCustomPeriod} disabled={!canEdit}>
            <Plus size={14} />
            시기 추가
          </button>
          <div className="roadmap-inline-banner">
            학원 기준은 고정 시기 외에도 사용자 시기를 만들어 반별 운영과 진도를 함께 관리할 수 있습니다.
          </div>
        </div>
      ) : null}
    </>
  );

  const schoolReportTable = (() => {
    if (schoolViewPreset === 'school-by-grade') {
      const baseSchools = selectedSchools.length > 0 ? selectedSchools : schoolOptions;
      return (
        <table className="roadmap-table roadmap-grade-table">
          <thead>
            <tr>
              <th className="roadmap-sticky-col">학교</th>
              {selectedSchoolGradeColumns.map((grade) => (
                <th key={grade}>
                  <div className="roadmap-period-header">
                    <span>{grade}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {baseSchools.length === 0 ? (
              <tr>
                <td colSpan={selectedSchoolGradeColumns.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학교 기준 로드맵이 없습니다.</td>
              </tr>
            ) : baseSchools.map((school) => (
              <tr key={school.id || schoolKey(school.name)}>
                <th className="roadmap-sticky-cell">
                  <strong>{school.name}</strong>
                  <span>{getSchoolCategoryLabel(school.category)}</span>
                </th>
                {selectedSchoolGradeColumns.map((grade) => (
                  <td key={grade} className="roadmap-cell">
                    <RoadmapCell
                      cell={buildSchoolCell(school, grade, schoolPeriodOptions)}
                      testId={`roadmap-school-cell-${school.id || schoolKey(school.name)}-${grade}`}
                      disabled={!canEditSchoolCells}
                      onClick={canEditSchoolCells ? ((event) =>
                        handleOpenSchoolEditor(
                          { school, grade },
                          null,
                          event.currentTarget,
                          { periodOptions: schoolPeriodOptions }
                        )) : undefined}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (schoolViewPreset === 'school-annual-board') {
      return (
        <table className="roadmap-table roadmap-board-table" data-testid="roadmap-school-annual-board">
          <thead>
            <tr>
              <th className="roadmap-sticky-col">학교</th>
              {selectedSchoolGradeColumns.map((grade) => (
                <th key={grade}>
                  <div className="roadmap-period-header">
                    <span>{grade}</span>
                  </div>
                </th>
              ))}
              {visibleScheduleColumnOptions.map((column) => (
                <th key={column.key}>
                  <div className="roadmap-period-header">
                    <span>{column.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schoolBoardRows.length === 0 ? (
              <tr>
                <td colSpan={selectedSchoolGradeColumns.length + visibleScheduleColumnOptions.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학교 연간표가 없습니다.</td>
              </tr>
            ) : schoolBoardRows.map((row) => (
              <tr key={row.id}>
                <th className="roadmap-sticky-cell">
                  <strong>{row.school.name}</strong>
                  <span>{getSchoolCategoryLabel(row.school.category)}</span>
                </th>
                {row.gradeCells.map((cell) => {
                  const linkedEvents = filterLinkedRoadmapEvents(
                    cell.cell.sections.flatMap((section) => section.linkedEvents || [])
                  );
                  return (
                    <td key={cell.grade} className="roadmap-cell">
                      <RoadmapCell
                        cell={cell.cell}
                        testId={`roadmap-school-board-cell-${row.id}-${cell.grade}`}
                        highlighted={isFocusedGradeCell(row.school, cell.grade)}
                        disabled={!canEditSchoolCells}
                        actions={linkedEvents.length > 0 ? (
                          <button
                            type="button"
                            className="roadmap-inline-icon-button"
                            data-testid={`roadmap-calendar-link-grade-${row.id}-${cell.grade}`}
                            aria-label="학사일정 열기"
                            onClick={(event) => {
                              event.stopPropagation();
                              openAcademicCalendarForLinkedEvents(linkedEvents, {
                                title: `${row.school.name} ${cell.grade} 학사일정`,
                                schoolId: row.school.id,
                                schoolKey: schoolKey(row.school.name),
                                schoolName: row.school.name,
                                schoolCategory: row.school.category,
                                grade: cell.grade,
                              });
                            }}
                          >
                            <CalendarDays size={14} />
                          </button>
                        ) : null}
                        onClick={canEditSchoolCells ? ((event) =>
                          handleOpenSchoolEditor(
                            { school: row.school, grade: cell.grade },
                            null,
                            event.currentTarget,
                            { periodOptions: schoolPeriodOptions }
                          )) : undefined}
                      />
                    </td>
                  );
                })}
                {row.scheduleGroups.map((group) => (
                  <td key={group.key} className="roadmap-cell roadmap-schedule-cell">
                    <div className={`roadmap-cell-static ${isFocusedScheduleCell(row.school, group.key) ? 'is-linked-focus' : ''}`.trim()}>
                      <div className="roadmap-cell-shell">
                        <div className="roadmap-cell-head">
                          <div className="roadmap-cell-head-actions">
                        {group.entries.length > 0 ? (
                          <button
                            type="button"
                            className="roadmap-inline-icon-button"
                            data-testid={`roadmap-calendar-link-schedule-${row.id}-${group.key}`}
                            aria-label="학사일정 열기"
                            onClick={() => openAcademicCalendarForLinkedEvents(group.entries, {
                              title: `${row.school.name} ${group.label}`,
                              schoolId: row.school.id,
                              schoolKey: schoolKey(row.school.name),
                              schoolName: row.school.name,
                              schoolCategory: row.school.category,
                              grade: group.entries[0]?.gradeValues?.[0] || '',
                            })}
                          >
                            <CalendarDays size={14} />
                          </button>
                        ) : null}
                          </div>
                        </div>
                      {group.entries.length === 0 ? (
                        <div className="roadmap-cell-empty">연동 일정 없음</div>
                      ) : (
                        <div className="roadmap-schedule-list">
                          {group.entries.map((entry) => (
                            <div key={entry.id || entry.summary} className="roadmap-schedule-item">{entry.summary}</div>
                          ))}
                        </div>
                      )}
                      </div>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    return (
      <table className="roadmap-table">
        <thead>
          <tr>
            <th className="roadmap-sticky-col">학교 / 학년</th>
            {schoolPeriodOptions.map((period) => (
              <th key={period.code}>
                <div className="roadmap-period-header">
                  <span>{period.label}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schoolRows.length === 0 ? (
            <tr>
              <td colSpan={schoolPeriodOptions.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학교 기준 로드맵이 없습니다.</td>
            </tr>
          ) : schoolRows.map((row) => (
            <tr key={row.id}>
              <th className="roadmap-sticky-cell">
                <strong>{row.school.name}</strong>
                <span>{row.grade}</span>
              </th>
              {schoolPeriodOptions.map((period) => (
                <td key={period.code} className="roadmap-cell">
                  <RoadmapCell
                    cell={buildSchoolCell(row.school, row.grade, [period])}
                    testId={`roadmap-school-cell-${row.id}-${period.code}`}
                    disabled={!canEditSchoolCells}
                    onClick={canEditSchoolCells ? ((event) => handleOpenSchoolEditor(row, period, event.currentTarget)) : undefined}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  })();

  const academyReportTable = (() => {
    const columnLabels = academyViewPreset === 'period-by-grade'
      ? (selectedAcademyGrade === ALL_ACADEMY_GRADES ? academyGradeOptions : [selectedAcademyGrade]).filter(Boolean)
      : academyPeriodOptions.map((period) => period.label);

    return (
      <table className="roadmap-table">
        <thead>
          <tr>
            <th className="roadmap-sticky-col">{academyViewPreset === 'period-by-grade' ? '시기' : '학년 / 수업'}</th>
            {columnLabels.map((label) => (
              <th key={label}>
                <div className="roadmap-period-header">
                  <span>{label}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {academyGroupedRows.length === 0 ? (
            <tr>
              <td colSpan={columnLabels.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학원 기준 로드맵이 없습니다.</td>
            </tr>
          ) : academyGroupedRows.map((row) => (
            <tr key={row.id}>
              <th className="roadmap-sticky-cell">
                <strong>{row.label}</strong>
                <span>{row.subtitle}</span>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.key} className="roadmap-cell">
                  <RoadmapCell
                    cell={cell.cell}
                    testId={`roadmap-academy-cell-${cell.key}`}
                    disabled={!cell.editable}
                    onClick={cell.editable ? (event) => openAcademyEditor(cell.row, cell.period, event.currentTarget) : undefined}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  })();

  const supportBanner = !isCheckingSupport && !roadmapSupport.ready ? (
    <StatusBanner
      variant="warning"
      title="교재·진도 테이블 준비 필요"
      message={`Supabase에서 새 시기별 교재·진도 테이블을 아직 찾지 못했습니다. 누락: ${(roadmapSupport.missingTables || []).join(', ')}`}
    />
  ) : null;

  if (isEmbeddedSchoolAnnualBoard) {
    return (
      <div className="academic-roadmap-embed" data-testid="academic-roadmap-embed">
        <DashboardFilterSheet
          open={Boolean(isMobile && isMobileFilterSheetOpen)}
          onClose={() => setIsMobileFilterSheetOpen(false)}
          onApply={() => setIsMobileFilterSheetOpen(false)}
          title="학교 연간일정표 필터"
          maxWidth={720}
          testId="academic-roadmap-filter-sheet"
        >
          <div className="roadmap-mobile-sheet-stack">
            <div className="roadmap-mobile-context-card roadmap-mobile-context-card--embedded">
              <div className="roadmap-mobile-context-head">
                <div>
                  <span className="academic-section-caption">학교 연간일정표</span>
                  <strong>{`${selectedYear}년 · ${selectedSubjectLabel}`}</strong>
                </div>
                <span className="roadmap-mobile-summary-badge">
                  {selectedSchoolScopeLabel}
                </span>
              </div>
            </div>
            {roadmapFilterControls}
          </div>
        </DashboardFilterSheet>

        {supportBanner}

        {isMobile ? (
          <div className="academic-roadmap-embed__mobile-actions">
            <button
              type="button"
              className="action-chip"
              data-testid="academic-roadmap-filter-button"
              onClick={() => setIsMobileFilterSheetOpen(true)}
            >
              필터
            </button>
          </div>
        ) : null}

        {!isMobile ? (
          <div className="academic-roadmap-embed__filters">
            {roadmapFilterControls}
          </div>
        ) : null}

        <div className="roadmap-report-scroll academic-roadmap-embed__report">
          <div ref={reportRef} className="roadmap-report-sheet academic-roadmap-embed__report-sheet">
            {schoolReportTable}
          </div>
        </div>

        <BottomSheet
          open={Boolean(calendarEventPicker)}
          onClose={() => setCalendarEventPicker(null)}
          title={calendarEventPicker?.title || '?곌껐???숈궗?쇱젙'}
          subtitle={calendarEventPicker?.subtitle || '?댁뼱蹂??쇱젙???좏깮??二쇱꽭??'}
          maxWidth={480}
          testId="roadmap-calendar-event-picker"
        >
          <div className="roadmap-calendar-picker-list">
            {(calendarEventPicker?.events || []).map((event) => (
              <button
                key={event.id || event.summary}
                type="button"
                className="roadmap-calendar-picker-item"
                data-testid={`roadmap-calendar-event-option-${event.id}`}
                onClick={() => {
                  onOpenAcademicCalendar?.(buildAcademicCalendarIntentFromLinkedEvent(event, calendarEventPicker?.context));
                  setCalendarEventPicker(null);
                }}
              >
                <strong>{event.title}</strong>
                <span>{event.summary}</span>
              </button>
            ))}
          </div>
        </BottomSheet>

        <div ref={editorRef}>
          {isMobile ? (
            <RoadmapCellEditorMobileSheet
              activeEditor={activeEditor}
              editorDraft={editorDraft}
              textbookSuggestions={textbookSuggestions}
              isSaving={isSaving}
              onClose={closeEditor}
              onChangeSchoolPeriod={syncSchoolEditorPeriod}
              onChangeScheduleEventType={syncSchoolEditorEventType}
              onChangeNote={(value) => setEditorDraft((current) => ({ ...current, note: value }))}
              onChangeExamRange={(patch) => setEditorDraft((current) => ({ ...current, ...patch }))}
              onChangeRow={updateEditorRow}
              onAddRow={addEditorRow}
              onRemoveRow={removeEditorRow}
              onSave={saveActiveEditor}
              scheduleTypeOptions={getRoadmapEditorEventTypeOptions(selectedSubject)}
            />
          ) : (
            <RoadmapCellEditorV2
              activeEditor={activeEditor}
              editorDraft={editorDraft}
              textbookSuggestions={textbookSuggestions}
              isSaving={isSaving}
              onClose={closeEditor}
              onChangeSchoolPeriod={syncSchoolEditorPeriod}
              onChangeScheduleEventType={syncSchoolEditorEventType}
              onChangeNote={(value) => setEditorDraft((current) => ({ ...current, note: value }))}
              onChangeExamRange={(patch) => setEditorDraft((current) => ({ ...current, ...patch }))}
              onChangeRow={updateEditorRow}
              onAddRow={addEditorRow}
              onRemoveRow={removeEditorRow}
              onSave={saveActiveEditor}
              scheduleTypeOptions={getRoadmapEditorEventTypeOptions(selectedSubject)}
            />
          )}
        </div>

        <ConfirmDialog {...dialogProps} />
      </div>
    );
  }

  return (
    <div className="view-container roadmap-view">
      <section className="workspace-surface roadmap-workspace">
        {supportBanner}

        <DashboardTopRail
          className="roadmap-top-rail"
          testId="roadmap-top-rail"
          eyebrow="교재·진도 워크스페이스"
          title="시기별 학교·학원 교재 로드맵"
          description="학교 시험범위와 학원 수업 계획을 한 화면에서 정리하고, A4 비율로 미리 본 뒤 PDF로 저장할 수 있습니다."
          summary={
            <>
              <span className="dashboard-summary-chip">{`${selectedYear}년 · ${selectedSubjectLabel}`}</span>
              <span className="dashboard-summary-chip">
                {activeTab === 'school' ? '학교 기준' : '학원 기준'} · {activePresetLabel}
              </span>
              {roadmapSummaryTokens.slice(0, 3).map((token) => (
                <span key={token} className="dashboard-summary-chip">{token}</span>
              ))}
            </>
          }
          actions={
            <>
              {isMobile ? (
                <button
                  type="button"
                  className="action-chip"
                  data-testid="roadmap-top-rail-filter-button"
                  onClick={() => setIsMobileFilterSheetOpen(true)}
                >
                  필터
                </button>
              ) : null}
              <button type="button" className="action-pill" onClick={printReport}>
                <FileDown size={16} />
                PDF 미리보기
              </button>
            </>
          }
          contextTabs={(
            <div className="workspace-tabs">
              {[
                { id: 'school', label: '학교 기준' },
                { id: 'academy', label: '학원 기준' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`h-segment-btn ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          filterBar={!isMobile ? roadmapFilterControls : null}
        />

        {false ? (
          <>
        <div className="roadmap-header">
          <div>
            <div className="roadmap-eyebrow">교재·진도 워크스페이스</div>
            <h2>시기별 학교·학원 교재 로드맵</h2>
            <p>학교 시험범위와 학원 수업계획을 한 표에서 관리하고, A4 비율로 미리본 뒤 PDF로 저장할 수 있습니다.</p>
          </div>
          <div className="roadmap-header-actions">
            <button type="button" className="action-pill" onClick={printReport}>
              <FileDown size={16} />
              PDF 미리보기
            </button>
          </div>
        </div>

        <div className="workspace-tabs">
          {[
            { id: 'school', label: '학교 기준' },
            { id: 'academy', label: '학원 기준' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`h-segment-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isMobile ? (
          <div className="card-custom roadmap-mobile-summary">
            <div className="roadmap-mobile-summary-head">
              <div>
                <div className="roadmap-mobile-summary-eyebrow">{selectedYear}년 · {selectedSubject}</div>
                <strong className="roadmap-mobile-summary-title">
                  {activeTab === 'school' ? '학교 기준' : '학원 기준'} · {activePresetLabel}
                </strong>
              </div>
              <div className="roadmap-mobile-summary-actions">
                <button
                  type="button"
                  className="action-chip"
                  onClick={() => setIsMobileFilterSheetOpen(true)}
                >
                  필터
                </button>
                <button type="button" className="action-chip" onClick={printReport}>
                  PDF
                </button>
              </div>
            </div>
            <div className="roadmap-mobile-summary-copy">
              {`${roadmapModeLabel} · ${roadmapScopeLabel}`}
            </div>
            <div className="roadmap-mobile-summary-actions">
              <span className="roadmap-mobile-summary-badge">{activePresetLabel}</span>
            </div>
            <div className="roadmap-mobile-summary-chips">
              {roadmapSummaryTokens.map((token) => (
                <span key={token} className="roadmap-mobile-summary-chip">{token}</span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="roadmap-filter-grid">
          <label className="curriculum-filter-field">
            <span>연도</span>
            <select
              className="styled-input"
              data-testid="roadmap-filter-year-select"
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </label>
          <label className="curriculum-filter-field">
            <span>과목</span>
            <select
              className="styled-input"
              data-testid="roadmap-filter-subject-select"
              value={selectedSubject}
              onChange={(event) => setSelectedSubject(event.target.value)}
            >
              {subjectOptions.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </label>

          {activeTab === 'school' ? (
            <>
              <label className="curriculum-filter-field">
                <span>학교 구분</span>
                <select className="styled-input" value={selectedSchoolCategory} onChange={(event) => { setSelectedSchoolCategory(event.target.value); setSelectedSchoolKey(ALL_SCHOOLS); }}>
                  {SCHOOL_CATEGORY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>학교</span>
                <select className="styled-input" value={selectedSchoolKey} onChange={(event) => setSelectedSchoolKey(event.target.value)}>
                  <option value={ALL_SCHOOLS}>전체 학교</option>
                  {schoolOptions.map((school) => (
                    <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>학년</span>
                <select className="styled-input" value={selectedSchoolGrade} onChange={(event) => setSelectedSchoolGrade(event.target.value)}>
                  <option value={ALL_GRADES}>전체 학년</option>
                  {schoolGradeOptions.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>시기</span>
                <select className="styled-input" value={selectedSchoolPeriod} onChange={(event) => setSelectedSchoolPeriod(event.target.value)}>
                  <option value={ALL_PERIODS}>전체 시기</option>
                  {FIXED_PERIODS_KO.map((period) => (
                    <option key={period.code} value={period.code}>{period.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="curriculum-filter-field">
                <span>학원 학년</span>
                <select className="styled-input" value={selectedAcademyGrade} onChange={(event) => { setSelectedAcademyGrade(event.target.value); setSelectedAcademyClass(ALL_CLASSES); }}>
                  <option value={ALL_ACADEMY_GRADES}>전체 학년</option>
                  {academyGradeOptions.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>실반</span>
                <select className="styled-input" value={selectedAcademyClass} onChange={(event) => setSelectedAcademyClass(event.target.value)}>
                  <option value={ALL_CLASSES}>전체 수업</option>
                  {academyClassOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>시기</span>
                <select className="styled-input" value={selectedAcademyPeriod} onChange={(event) => setSelectedAcademyPeriod(event.target.value)}>
                  <option value={ALL_PERIODS}>전체 시기</option>
                  {academyPeriodOptions.map((period) => (
                    <option key={period.code} value={period.code}>{period.label}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>표시 기준</span>
                <select className="styled-input" value={academyScopeMode} onChange={(event) => setAcademyScopeMode(event.target.value)}>
                  <option value="priority">실반 우선</option>
                  <option value="class">실반만</option>
                  <option value="template">템플릿만</option>
                </select>
              </label>
            </>
          )}
        </div>

        {activeTab === 'academy' ? <div className="roadmap-view-preset-row">
          <div className="roadmap-view-preset-group">
            <span className="roadmap-view-preset-label">보기 프리셋</span>
            {(activeTab === 'school' ? SCHOOL_VIEW_PRESET_OPTIONS : ACADEMY_VIEW_PRESET_OPTIONS).map((preset) => {
              const activePreset = activeTab === 'school' ? schoolViewPreset : academyViewPreset;
              const setPreset = activeTab === 'school' ? setSchoolViewPreset : setAcademyViewPreset;
              return (
                <button
                  key={preset.value}
                  type="button"
                  className={`action-chip ${activePreset === preset.value ? 'active' : ''}`}
                  onClick={() => setPreset(preset.value)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div> : null}

        {activeTab === 'academy' ? (
          <div className="roadmap-custom-period-row">
            <label className="curriculum-filter-field roadmap-custom-period-field">
              <span>사용자 시기</span>
              <input
                className="styled-input"
                value={customPeriodLabel}
                onChange={(event) => setCustomPeriodLabel(event.target.value)}
                placeholder="예: 여름방학 특강"
                disabled={!canEdit}
              />
            </label>
            <button type="button" className="action-chip" onClick={addCustomPeriod} disabled={!canEdit}>
              <Plus size={14} />
              시기 추가
            </button>
            <div className="roadmap-inline-banner">
              학원 기준은 고정 4시기 외에 사용자 시기를 더 만들어 운영안과 실반 진도를 함께 관리할 수 있습니다.
            </div>
          </div>
        ) : (
          <div className="roadmap-inline-banner">
            학교 기준 표는 시험 시기별 교과서·부교재·기타 자료와 시험범위를 한 셀에서 함께 관리합니다.
          </div>
        )}

          </>
        ) : null}

        <DashboardFilterSheet
          open={Boolean(isMobile && isMobileFilterSheetOpen)}
          onClose={() => setIsMobileFilterSheetOpen(false)}
          onApply={() => setIsMobileFilterSheetOpen(false)}
          title="로드맵 필터"
          subtitle="연도, 과목, 보기 프리셋과 범위를 한 번에 조정합니다."
          maxWidth={720}
          testId="roadmap-filter-sheet"
        >
          <div className="roadmap-mobile-sheet-stack">
            <div className="roadmap-mobile-context-card" data-testid="roadmap-mobile-context-card">
              <div className="roadmap-mobile-context-head">
                <div>
                  <span className="academic-section-caption">현재 기준</span>
                  <strong>{roadmapModeLabel}</strong>
                </div>
                <span className="roadmap-mobile-summary-badge">{roadmapScopeLabel}</span>
              </div>
              <div className="roadmap-mobile-context-copy">
                연도, 과목, 보기 프리셋을 먼저 맞춘 뒤 필요한 셀만 바로 편집하면 됩니다.
              </div>
              <div className="roadmap-mobile-summary-chips">
                {roadmapSheetContextTokens.map((token) => (
                  <span key={token} className="roadmap-mobile-summary-chip">{token}</span>
                ))}
              </div>
            </div>
            {roadmapFilterControls}
          </div>
        </DashboardFilterSheet>

        <div className="roadmap-report-scroll">
          <div ref={reportRef} className="roadmap-report-sheet">
            {activeTab === 'school' ? schoolReportTable : academyReportTable}
            {/*
              <table className="roadmap-table">
                <thead>
                  <tr>
                    <th className="roadmap-sticky-col">학교 / 학년</th>
                    {schoolPeriodOptions.map((period) => (
                      <th key={period.code}>
                        <div className="roadmap-period-header">
                          <span>{period.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schoolRows.length === 0 ? (
                    <tr>
                      <td colSpan={schoolPeriodOptions.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학교 기준 로드맵이 없습니다.</td>
                    </tr>
                  ) : schoolRows.map((row) => (
                    <tr key={row.id}>
                      <th className="roadmap-sticky-cell">
                        <strong>{row.school.name}</strong>
                        <span>{row.grade}</span>
                      </th>
                      {schoolPeriodOptions.map((period) => {
                        const plan = row.school.id ? schoolPlanByKey.get(`${row.school.id}::${row.grade}::${period.code}`) : null;
                        const items = plan ? schoolItemsByPlanId.get(plan.id) || [] : [];
                        const cell = {
                          note: plan?.note || '',
                          itemsByCategory: groupItemsByCategory(items, 'scopeDetail'),
                        };
                        return (
                          <td key={period.code} className="roadmap-cell">
                            <RoadmapCell cell={cell} onClick={(event) => openSchoolEditor(row, period, event.currentTarget)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="roadmap-table">
                <thead>
                  <tr>
                    <th className="roadmap-sticky-col">학년 / 수업</th>
                    {academyPeriodOptions.map((period) => (
                      <th key={period.code}>
                        <div className="roadmap-period-header">
                          <span>{period.label}</span>
                          {period.periodType === 'custom' && canEdit && selectedAcademyGrade !== ALL_ACADEMY_GRADES ? (
                            <div className="roadmap-period-header-actions">
                              <button type="button" className="roadmap-period-header-action" onClick={() => renameCustomPeriod(period)} aria-label="시기 이름 수정">
                                <Pencil size={13} />
                              </button>
                              <button type="button" className="roadmap-period-header-action" onClick={() => deleteCustomPeriod(period)} aria-label="시기 삭제">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {academyRows.length === 0 ? (
                    <tr>
                      <td colSpan={academyPeriodOptions.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학원 기준 로드맵이 없습니다.</td>
                    </tr>
                  ) : academyRows.map((row) => (
                    <tr key={row.id}>
                      <th className="roadmap-sticky-cell">
                        <strong>{row.label}</strong>
                        <span>{row.academyGrade} · {row.scopeType === 'class' ? '실반' : '템플릿'}</span>
                      </th>
                      {academyPeriodOptions.map((period) => {
                        const plan = academyPlanByKey.get(`${row.academyGrade}::${row.scopeType}::${row.classId || ''}::${period.code}`) || null;
                        const items = plan ? academyItemsByPlanId.get(plan.id) || [] : [];
                        const cell = {
                          note: plan?.note || '',
                          itemsByCategory: groupItemsByCategory(items, 'planDetail'),
                        };
                        return (
                          <td key={period.code} className="roadmap-cell">
                            <RoadmapCell cell={cell} onClick={(event) => openAcademyEditor(row, period, event.currentTarget)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            */}
          </div>
        </div>
      </section>

      <BottomSheet
        open={Boolean(calendarEventPicker)}
        onClose={() => setCalendarEventPicker(null)}
        title={calendarEventPicker?.title || '연결된 학사일정'}
        subtitle={calendarEventPicker?.subtitle || '열어볼 일정을 선택해 주세요.'}
        maxWidth={480}
        testId="roadmap-calendar-event-picker"
      >
        <div className="roadmap-calendar-picker-list">
          {(calendarEventPicker?.events || []).map((event) => (
            <button
              key={event.id || event.summary}
              type="button"
              className="roadmap-calendar-picker-item"
              data-testid={`roadmap-calendar-event-option-${event.id}`}
              onClick={() => {
                onOpenAcademicCalendar?.(buildAcademicCalendarIntentFromLinkedEvent(event, calendarEventPicker?.context));
                setCalendarEventPicker(null);
              }}
            >
              <strong>{event.title}</strong>
              <span>{event.summary}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <div ref={editorRef}>
        {isMobile ? (
          <RoadmapCellEditorMobileSheet
            activeEditor={activeEditor}
            editorDraft={editorDraft}
            textbookSuggestions={textbookSuggestions}
            isSaving={isSaving}
            onClose={closeEditor}
            onChangeSchoolPeriod={syncSchoolEditorPeriod}
            onChangeScheduleEventType={syncSchoolEditorEventType}
            onChangeNote={(value) => setEditorDraft((current) => ({ ...current, note: value }))}
            onChangeExamRange={(patch) => setEditorDraft((current) => ({ ...current, ...patch }))}
            onChangeRow={updateEditorRow}
            onAddRow={addEditorRow}
            onRemoveRow={removeEditorRow}
            onSave={saveActiveEditor}
            scheduleTypeOptions={getRoadmapEditorEventTypeOptions(selectedSubject)}
          />
        ) : (
          <RoadmapCellEditorV2
            activeEditor={activeEditor}
            editorDraft={editorDraft}
            textbookSuggestions={textbookSuggestions}
            isSaving={isSaving}
            onClose={closeEditor}
            onChangeSchoolPeriod={syncSchoolEditorPeriod}
            onChangeScheduleEventType={syncSchoolEditorEventType}
            onChangeNote={(value) => setEditorDraft((current) => ({ ...current, note: value }))}
            onChangeExamRange={(patch) => setEditorDraft((current) => ({ ...current, ...patch }))}
            onChangeRow={updateEditorRow}
            onAddRow={addEditorRow}
            onRemoveRow={removeEditorRow}
            onSave={saveActiveEditor}
            scheduleTypeOptions={getRoadmapEditorEventTypeOptions(selectedSubject)}
          />
        )}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
