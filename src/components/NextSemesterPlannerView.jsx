import { Component, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LayoutGrid, Plus, RotateCcw, RotateCw, Save, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import TimetableGrid from './ui/TimetableGrid';
import {
  DAY_LABELS,
  generateTimeSlots,
  parseSchedule,
  splitClassroomList,
  splitTeacherList,
  stripClassPrefix,
  timeToSlotIndex,
} from '../data/sampleData';
import { normalizeClassroomText } from '../lib/classroomUtils';
import { sortSubjectOptions } from '../lib/subjectUtils';
import { normalizeClassStatus, PREPARING_CLASS_STATUS } from '../lib/classStatus';
import { getClassExamConflictsForDates } from '../lib/examScheduleUtils';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { useToast } from '../contexts/ToastContext';

const TIME_SLOTS = generateTimeSlots(9, 24);
const WORKDAYS = DAY_LABELS;
const FALLBACK_RESOURCE = '미배정';
const DEFAULT_DROP_DURATION_SLOTS = 4;
const SURFACE_META = {
  'classroom-weekly': { title: '강의실 주간 배치', daily: false, resource: 'classroom' },
  'teacher-weekly': { title: '선생님 주간 배치', daily: false, resource: 'teacher' },
  'daily-classroom': { title: '일별 강의실 배치', daily: true, resource: 'classroom' },
  'daily-teacher': { title: '일별 선생님 배치', daily: true, resource: 'teacher' },
};

class PlannerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Planner render failed:', error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card-custom" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
          배치 화면을 불러오는 중 문제가 발생했습니다. 필터를 바꾸거나 화면을 다시 열어 주세요.
        </div>
      );
    }

    return this.props.children;
  }
}

function text(value) {
  return String(value || '').trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function createId(prefix = 'draft') {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortLines(lines = []) {
  return [...lines].sort((left, right) => {
    const dayDiff = DAY_LABELS.indexOf(left.day) - DAY_LABELS.indexOf(right.day);
    if (dayDiff !== 0) return dayDiff;
    return String(left.start || '').localeCompare(String(right.start || ''));
  });
}

function scheduleSummary(lines = []) {
  const grouped = new Map();
  sortLines(lines).forEach((line) => {
    const key = `${line.start}-${line.end}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(line.day);
  });
  return [...grouped.entries()].map(([timeKey, days]) => `${days.join('')} ${timeKey}`).join(', ');
}

function toDraftEntry(classItem) {
  const slots = parseSchedule(classItem.schedule, classItem);
  const baseTeacher = splitTeacherList(classItem.teacher || '')[0] || text(classItem.teacher);
  const baseClassroom = splitClassroomList(classItem.classroom || classItem.room || '')[0] || normalizeClassroomText(classItem.classroom || classItem.room || '');
  return {
    classId: classItem.id,
    className: classItem.className || classItem.name || '',
    subject: classItem.subject || '',
    teacher: text(classItem.teacher),
    classroom: normalizeClassroomText(classItem.classroom || classItem.room || ''),
    period: text(classItem.period),
    status: normalizeClassStatus(classItem.status) || PREPARING_CLASS_STATUS,
    studentIds: classItem.studentIds || [],
    isNew: false,
    source: classItem,
    scheduleLines: slots.map((slot, index) => ({
      id: `${classItem.id}-${index}`,
      day: slot.day,
      start: slot.start,
      end: slot.end,
      teacher: text(slot.teacher || baseTeacher),
      classroom: normalizeClassroomText(slot.classroom || baseClassroom),
    })),
  };
}

function createDraftEntry(name, subject, period, status) {
  return {
    classId: createId(),
    className: text(name),
    subject: text(subject) || '영어',
    teacher: '',
    classroom: '',
    period: text(period),
    status: normalizeClassStatus(status) || PREPARING_CLASS_STATUS,
    studentIds: [],
    isNew: true,
    source: null,
    scheduleLines: [],
  };
}

function buildPresetScheduleLine(day, start, end, teacher, classroom) {
  if (!DAY_LABELS.includes(day) || !text(start)) {
    return null;
  }

  const startSlot = timeToSlotIndex(start, 9);
  if (!Number.isFinite(startSlot) || startSlot < 0) {
    return null;
  }

  let safeEnd = text(end);
  if (!safeEnd) {
    const fallbackEndIndex = Math.min(startSlot + DEFAULT_DROP_DURATION_SLOTS - 1, TIME_SLOTS.length - 1);
    safeEnd = safeTimeAt(fallbackEndIndex, 'end');
  }

  const endSlot = Math.max(timeToSlotIndex(safeEnd, 9), startSlot + 1);
  return {
    id: createId('line'),
    day,
    start: safeTimeAt(startSlot, 'start'),
    end: safeTimeAt(Math.max(startSlot, endSlot - 1), 'end'),
    teacher: text(teacher),
    classroom: normalizeClassroomText(classroom),
  };
}

function normalizeScheduleLine(line, fallbackEntry = {}) {
  if (!line || !DAY_LABELS.includes(line.day)) {
    return null;
  }

  const start = text(line.start);
  const end = text(line.end);
  if (!start || !end) {
    return null;
  }

  const startSlot = timeToSlotIndex(start, 9);
  const endSlot = Math.max(timeToSlotIndex(end, 9), startSlot + 1);
  if (!Number.isFinite(startSlot) || !Number.isFinite(endSlot) || startSlot < 0 || endSlot <= startSlot) {
    return null;
  }

  return {
    id: line.id || createId('line'),
    day: line.day,
    start,
    end,
    teacher: text(line.teacher || fallbackEntry.teacher),
    classroom: normalizeClassroomText(line.classroom || fallbackEntry.classroom),
  };
}

function normalizeDraftEntry(entry) {
  if (!entry) {
    return null;
  }

  return {
    ...entry,
    classId: entry.classId || createId(),
    className: text(entry.className || entry.name || '새 수업'),
    subject: text(entry.subject) || '영어',
    teacher: text(entry.teacher),
    classroom: normalizeClassroomText(entry.classroom),
    period: text(entry.period),
    status: normalizeClassStatus(entry.status) || PREPARING_CLASS_STATUS,
    studentIds: Array.isArray(entry.studentIds) ? entry.studentIds : [],
    scheduleLines: sortLines(
      (Array.isArray(entry.scheduleLines) ? entry.scheduleLines : [])
        .map((line) => normalizeScheduleLine(line, entry))
        .filter(Boolean)
    ),
  };
}

function sanitizeDraftMap(entries) {
  return Object.fromEntries(
    Object.entries(entries || {})
      .map(([key, value]) => [key, normalizeDraftEntry(value)])
      .filter(([, value]) => Boolean(value))
  );
}

function serializeDraftMap(entries) {
  return Object.fromEntries(
    Object.entries(entries || {})
      .map(([key, value]) => {
        const normalized = normalizeDraftEntry(value);
        if (!normalized) {
          return [key, null];
        }
        return [key, {
          classId: normalized.classId,
          className: normalized.className,
          subject: normalized.subject,
          teacher: normalized.teacher,
          classroom: normalized.classroom,
          period: normalized.period,
          status: normalized.status,
          studentIds: normalized.studentIds,
          isNew: normalized.isNew,
          scheduleLines: normalized.scheduleLines,
        }];
      })
      .filter(([, value]) => Boolean(value))
  );
}

function getDraftEntrySignature(entry) {
  const normalized = normalizeDraftEntry(entry);
  if (!normalized) {
    return '';
  }

  return JSON.stringify({
    className: normalized.className,
    subject: normalized.subject,
    teacher: normalized.teacher,
    classroom: normalized.classroom,
    period: normalized.period,
    status: normalized.status,
    scheduleLines: normalized.scheduleLines,
  });
}

function getPlannerKey(termKey, subject, surface) {
  return `planner:term:${termKey || 'workspace'}:${subject || 'all'}:${surface}`;
}

function getPlannerDensityKey(surface) {
  return `tips-dashboard:planner-density:${surface}`;
}

function buildResourceOptions(classes, type, subject) {
  const values = (classes || [])
    .filter((item) => !subject || item.subject === subject)
    .flatMap((item) => (type === 'teacher'
      ? splitTeacherList(item.teacher || '')
      : splitClassroomList(item.classroom || item.room || '')))
    .map((value) => (type === 'teacher' ? text(value) : normalizeClassroomText(value)))
    .filter(Boolean);
  return unique(values).sort((left, right) => left.localeCompare(right, 'ko'));
}

function buildDraftResourceOptions(entries, type) {
  const values = Object.values(entries || {}).flatMap((entry) => {
    const baseValue = type === 'teacher'
      ? text(entry.teacher)
      : normalizeClassroomText(entry.classroom);
    const lineValues = (entry.scheduleLines || []).map((line) => (
      type === 'teacher'
        ? text(line.teacher || entry.teacher)
        : normalizeClassroomText(line.classroom || entry.classroom)
    ));
    return [baseValue, ...lineValues];
  }).filter(Boolean);

  return unique(values).sort((left, right) => left.localeCompare(right, 'ko'));
}

function hasUnassignedResource(entries, type) {
  return Object.values(entries || {}).some((entry) => {
    const baseValue = type === 'teacher'
      ? text(entry.teacher)
      : normalizeClassroomText(entry.classroom);

    if (!baseValue) {
      return true;
    }

    return (entry.scheduleLines || []).some((line) => {
      const lineValue = type === 'teacher'
        ? text(line.teacher || entry.teacher)
        : normalizeClassroomText(line.classroom || entry.classroom);
      return !lineValue;
    });
  });
}

function compareDraftEntries(left, right, warningsByClassId) {
  const leftUnplaced = (left.scheduleLines || []).length === 0 ? 1 : 0;
  const rightUnplaced = (right.scheduleLines || []).length === 0 ? 1 : 0;
  if (leftUnplaced !== rightUnplaced) {
    return rightUnplaced - leftUnplaced;
  }

  const leftWarnings = warningsByClassId.get(left.classId)?.length || 0;
  const rightWarnings = warningsByClassId.get(right.classId)?.length || 0;
  if (leftWarnings !== rightWarnings) {
    return rightWarnings - leftWarnings;
  }

  return stripClassPrefix(left.className || '').localeCompare(stripClassPrefix(right.className || ''), 'ko');
}

function buildScheduleString(entry) {
  const lines = sortLines(entry.scheduleLines || []);
  const teacherBase = text(entry.teacher || unique(lines.map((line) => text(line.teacher)))[0] || '');
  const classroomBase = normalizeClassroomText(entry.classroom || unique(lines.map((line) => normalizeClassroomText(line.classroom)))[0] || '');
  return lines.map((line) => {
    const overrides = [];
    const nextTeacher = text(line.teacher || teacherBase);
    const nextClassroom = normalizeClassroomText(line.classroom || classroomBase);
    if (nextTeacher && nextTeacher !== teacherBase) overrides.push(nextTeacher);
    if (nextClassroom && nextClassroom !== classroomBase) overrides.push(nextClassroom);
    return `${line.day} ${line.start}-${line.end}${overrides.length ? `(${overrides.join('/')})` : ''}`;
  }).join('\n');
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function safeTimeAt(slotIndex, edge) {
  const item = TIME_SLOTS[Math.max(0, Math.min(slotIndex, TIME_SLOTS.length - 1))] || '09:00-09:30';
  return item.split('-')[edge === 'end' ? 1 : 0] || (edge === 'end' ? '09:30' : '09:00');
}

function normalizePlacementRange(startSlot, endSlot, defaultDuration = DEFAULT_DROP_DURATION_SLOTS) {
  const safeStart = Math.max(0, Number(startSlot) || 0);
  const requestedEnd = Math.max(safeStart + 1, Number(endSlot) || safeStart + 1);
  const usesSingleCell = requestedEnd - safeStart <= 1;
  const nextEnd = usesSingleCell
    ? Math.min(safeStart + defaultDuration, TIME_SLOTS.length)
    : Math.min(requestedEnd, TIME_SLOTS.length);

  return {
    startSlot: safeStart,
    endSlot: Math.max(safeStart + 1, nextEnd),
  };
}

export default function NextSemesterPlannerView({
  surface = 'classroom-weekly',
  classes = [],
  allClasses = classes,
  data,
  dataService,
  defaultStatus = PREPARING_CLASS_STATUS,
  defaultPeriod = '',
  termKey = '',
  termStatus = PREPARING_CLASS_STATUS,
  terms = [],
  selectedBoardValue = '',
}) {
  const toast = useToast();
  const meta = SURFACE_META[surface] || SURFACE_META['classroom-weekly'];
  const densityStorageKey = getPlannerDensityKey(surface);
  const initialSubjects = sortSubjectOptions(unique([...(classes || []), ...(allClasses || [])].map((item) => item.subject).filter(Boolean)));
  const [density, setDensity] = useState(() => {
    if (typeof window === 'undefined') {
      return 1;
    }
    const saved = Number(window.localStorage.getItem(getPlannerDensityKey(surface)));
    return Number.isFinite(saved) && saved >= 1 && saved <= 6 ? saved : 1;
  });
  const [draftName, setDraftName] = useState('');
  const [selectedSubject, setSelectedSubject] = useState(initialSubjects[0] || '');
  const [draftTeacher, setDraftTeacher] = useState('');
  const [draftClassroom, setDraftClassroom] = useState('');
  const [draftDay, setDraftDay] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [draftEntries, setDraftEntries] = useState({});
  const [periodInput, setPeriodInput] = useState(defaultPeriod || termKey || '');
  const [isApplying, setIsApplying] = useState(false);
  const [draggingDraftId, setDraggingDraftId] = useState('');
  const [externalPreview, setExternalPreview] = useState(null);
  const [historyStack, setHistoryStack] = useState([]);
  const [futureStack, setFutureStack] = useState([]);
  const draftEntriesRef = useRef(draftEntries);
  const selectedClassIdRef = useRef(selectedClassId);

  const subjectOptions = useMemo(
    () => sortSubjectOptions(unique([...(classes || []), ...(allClasses || [])].map((item) => item.subject).filter(Boolean))),
    [allClasses, classes]
  );
  const startTimeOptions = useMemo(
    () => unique(TIME_SLOTS.map((slot) => slot.split('-')[0]).filter(Boolean)),
    []
  );
  const endTimeOptions = useMemo(() => {
    if (!draftStart) {
      return unique(TIME_SLOTS.map((slot) => slot.split('-')[1]).filter(Boolean));
    }
    const startIndex = Math.max(0, timeToSlotIndex(draftStart, 9));
    return unique(TIME_SLOTS.slice(startIndex).map((slot) => slot.split('-')[1]).filter(Boolean));
  }, [draftStart]);

  const teacherSummary = useMemo(() => {
    const entry = draftEntries[selectedClassId] || null;
    if (!entry) return '미정';
    return unique((entry.scheduleLines || []).map((line) => text(line.teacher || entry.teacher)).filter(Boolean)).join(', ') || text(entry.teacher) || '미정';
  }, [draftEntries, selectedClassId]);

  const classroomSummary = useMemo(() => {
    const entry = draftEntries[selectedClassId] || null;
    if (!entry) return '미정';
    return unique((entry.scheduleLines || []).map((line) => normalizeClassroomText(line.classroom || entry.classroom)).filter(Boolean)).join(', ') || normalizeClassroomText(entry.classroom) || '미정';
  }, [draftEntries, selectedClassId]);

  const scheduleLabel = useMemo(() => {
    const entry = draftEntries[selectedClassId] || null;
    return entry ? (scheduleSummary(entry.scheduleLines) || '시간 미정') : '시간 미정';
  }, [draftEntries, selectedClassId]);

  const pushHistorySnapshot = (entriesSnapshot = draftEntriesRef.current, selectedSnapshot = selectedClassIdRef.current) => {
    const serialized = serializeDraftMap(entriesSnapshot);
    setHistoryStack((current) => [
      ...current.slice(-19),
      { entries: serialized, selectedClassId: selectedSnapshot || '' },
    ]);
    setFutureStack([]);
  };

  useEffect(() => {
    if (!selectedSubject && subjectOptions.length > 0) {
      setSelectedSubject(subjectOptions[0]);
    }
  }, [selectedSubject, subjectOptions]);

  useEffect(() => {
    if (!draftStart || !draftEnd) {
      return;
    }

    const startIndex = timeToSlotIndex(draftStart, 9);
    const endIndex = timeToSlotIndex(draftEnd, 9);
    if (endIndex <= startIndex) {
      setDraftEnd('');
    }
  }, [draftEnd, draftStart]);

  const plannerKey = useMemo(
    () => getPlannerKey(termKey || periodInput, selectedSubject, surface),
    [periodInput, selectedSubject, surface, termKey]
  );
  const seedClasses = useMemo(
    () => (classes || []).filter((item) => !selectedSubject || item.subject === selectedSubject),
    [classes, selectedSubject]
  );
  const resourceSource = useMemo(
    () => (normalizeClassStatus(termStatus) === PREPARING_CLASS_STATUS ? (allClasses || []) : (classes || [])),
    [allClasses, classes, termStatus]
  );
  const termInfo = useMemo(
    () => (terms || []).find((term) => String(term.id) === String(termKey) || text(term.name) === text(periodInput) || text(term.name) === text(termKey)),
    [periodInput, termKey, terms]
  );
  const draftResourceOptions = useMemo(
    () => buildDraftResourceOptions(draftEntries, meta.resource),
    [draftEntries, meta.resource]
  );
  const resourceOptions = useMemo(
    () => unique([
      ...buildResourceOptions(resourceSource, meta.resource, selectedSubject),
      ...draftResourceOptions,
    ]).sort((left, right) => left.localeCompare(right, 'ko')),
    [draftResourceOptions, meta.resource, resourceSource, selectedSubject]
  );

  useEffect(() => {
    let cancelled = false;
    const baseEntries = sanitizeDraftMap(Object.fromEntries(seedClasses.map((item) => [item.id, toDraftEntry(item)])));
    setDraftEntries(baseEntries);
    setSelectedClassId(Object.keys(baseEntries)[0] || '');
    setPeriodInput(defaultPeriod || termKey || seedClasses[0]?.period || '');
    setHistoryStack([]);
    setFutureStack([]);

    (async () => {
      try {
        const saved = await dataService.getAppPreference(plannerKey);
        if (cancelled || !saved?.value?.entries) return;
        setDraftEntries((current) => sanitizeDraftMap({ ...current, ...saved.value.entries }));
        setSelectedClassId(saved.value.selectedClassId || Object.keys(saved.value.entries || {})[0] || Object.keys(baseEntries)[0] || '');
        if (saved.value.period) setPeriodInput(saved.value.period);
      } catch (error) {
        console.warn('planner hydrate failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataService, defaultPeriod, plannerKey, seedClasses, termKey]);

  useEffect(() => {
    const entryIds = Object.keys(draftEntries || {});
    if (entryIds.length === 0) {
      if (selectedClassId) setSelectedClassId('');
      return;
    }
    if (!selectedClassId || !draftEntries[selectedClassId]) {
      setSelectedClassId(entryIds[0]);
    }
  }, [draftEntries, selectedClassId]);

  useEffect(() => {
    if (draggingDraftId && !draftEntries[draggingDraftId]) {
      setDraggingDraftId('');
      setExternalPreview(null);
    }
  }, [draftEntries, draggingDraftId]);

  useEffect(() => {
    draftEntriesRef.current = draftEntries;
  }, [draftEntries]);

  useEffect(() => {
    selectedClassIdRef.current = selectedClassId;
  }, [selectedClassId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(densityStorageKey, String(Math.max(1, density)));
  }, [density, densityStorageKey]);

  useEffect(() => {
    if (!selectedSubject) return undefined;
    const timeout = window.setTimeout(() => {
      dataService.setAppPreference(plannerKey, {
        entries: serializeDraftMap(draftEntries),
        selectedClassId,
        period: periodInput,
      }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [dataService, draftEntries, periodInput, plannerKey, selectedClassId, selectedSubject]);

  const safeResourceOptions = useMemo(() => {
    const next = [...resourceOptions];
    if (next.length === 0 || hasUnassignedResource(draftEntries, meta.resource)) {
      next.unshift(FALLBACK_RESOURCE);
    }
    return unique(next);
  }, [draftEntries, meta.resource, resourceOptions]);
  const selectedEntry = draftEntries[selectedClassId] || null;
  const preferredBoardValue = useMemo(() => {
    if (meta.daily) {
      return '';
    }
    if (meta.resource === 'teacher') {
      return teacherSummary === '미정' ? FALLBACK_RESOURCE : teacherSummary;
    }
    return classroomSummary === '미정' ? FALLBACK_RESOURCE : classroomSummary;
  }, [classroomSummary, meta.daily, meta.resource, teacherSummary]);
  const boardKeys = useMemo(() => {
    if (meta.daily) {
      return WORKDAYS;
    }
    return [...safeResourceOptions].sort((left, right) => {
      if (left === preferredBoardValue) return -1;
      if (right === preferredBoardValue) return 1;
      if (left === FALLBACK_RESOURCE) return -1;
      if (right === FALLBACK_RESOURCE) return 1;
      return left.localeCompare(right, 'ko');
    });
  }, [meta.daily, preferredBoardValue, safeResourceOptions]);
  const columnValues = meta.daily ? safeResourceOptions : WORKDAYS;
  const draggingEntry = draftEntries[draggingDraftId] || null;
  const teacherOptions = useMemo(
    () => unique([
      ...buildResourceOptions(allClasses || [], 'teacher', selectedSubject),
      ...buildDraftResourceOptions(draftEntries, 'teacher'),
    ]).sort((left, right) => left.localeCompare(right, 'ko')),
    [allClasses, draftEntries, selectedSubject]
  );
  const classroomOptions = useMemo(
    () => unique([
      ...buildResourceOptions(allClasses || [], 'classroom', selectedSubject),
      ...buildDraftResourceOptions(draftEntries, 'classroom'),
    ]).sort((left, right) => left.localeCompare(right, 'ko')),
    [allClasses, draftEntries, selectedSubject]
  );

  const warningsByClassId = useMemo(() => {
    try {
      const warningMap = new Map();
      const slots = [];

      Object.values(draftEntries).forEach((entry) => {
        (entry.scheduleLines || []).forEach((line) => {
          slots.push({
            classId: entry.classId,
            day: line.day,
            start: line.start,
            end: line.end,
            teacher: text(line.teacher || entry.teacher),
            classroom: normalizeClassroomText(line.classroom || entry.classroom),
          });
        });
      });

      slots.forEach((slot, index) => {
        slots.slice(index + 1).forEach((other) => {
          if (slot.day !== other.day || !overlap(slot.start, slot.end, other.start, other.end)) return;
          const bucket = warningMap.get(slot.classId) || [];
          const otherBucket = warningMap.get(other.classId) || [];
          if (slot.teacher && slot.teacher === other.teacher && !bucket.includes('선생님 충돌')) bucket.push('선생님 충돌');
          if (slot.classroom && slot.classroom === other.classroom && !bucket.includes('강의실 충돌')) bucket.push('강의실 충돌');
          if (slot.teacher && slot.teacher === other.teacher && !otherBucket.includes('선생님 충돌')) otherBucket.push('선생님 충돌');
          if (slot.classroom && slot.classroom === other.classroom && !otherBucket.includes('강의실 충돌')) otherBucket.push('강의실 충돌');
          warningMap.set(slot.classId, bucket);
          warningMap.set(other.classId, otherBucket);
        });
      });

      const startDate = termInfo?.startDate || termInfo?.start_date;
      const endDate = termInfo?.endDate || termInfo?.end_date || startDate;
      if (startDate && endDate) {
        Object.values(draftEntries).forEach((entry) => {
          const dates = [];
          const dayIndexMap = new Map(DAY_LABELS.map((day, index) => [day, index]));
          const wanted = new Set((entry.scheduleLines || []).map((line) => dayIndexMap.get(line.day)).filter((value) => value >= 0));
          const cursor = new Date(startDate);
          const end = new Date(endDate);
          while (cursor <= end) {
            if (wanted.has(cursor.getDay())) dates.push(cursor.toISOString().slice(0, 10));
            cursor.setDate(cursor.getDate() + 1);
          }

          const conflicts = getClassExamConflictsForDates(
            { id: entry.classId, className: entry.className, subject: entry.subject, studentIds: entry.studentIds || [] },
            dates,
            data?.students || [],
            data?.academicSchools || [],
            data?.academicExamDays || [],
            data?.academicEventExamDetails || [],
            data?.academicEvents || []
          );

          if (conflicts.length > 0) {
            const bucket = warningMap.get(entry.classId) || [];
            conflicts.forEach((conflict) => {
              if (!bucket.includes(conflict.message)) bucket.push(conflict.message);
            });
            warningMap.set(entry.classId, bucket);
          }
        });
      }

      return warningMap;
    } catch (error) {
      console.warn('planner warnings failed', error);
      return new Map();
    }
  }, [data, draftEntries, termInfo]);

  const draftItems = useMemo(
    () => Object.values(draftEntries).sort((left, right) => compareDraftEntries(left, right, warningsByClassId)),
    [draftEntries, warningsByClassId]
  );

  const unplacedCount = useMemo(
    () => draftItems.filter((entry) => (entry.scheduleLines || []).length === 0).length,
    [draftItems]
  );

  const placedCount = useMemo(
    () => draftItems.filter((entry) => (entry.scheduleLines || []).length > 0).length,
    [draftItems]
  );

  const boardConfigs = useMemo(() => {
    try {
      return boardKeys.map((boardKey) => {
        const blocks = Object.values(draftEntries)
          .flatMap((entry) => (entry.scheduleLines || [])
            .filter((line) => {
              if (meta.daily) {
                return line.day === boardKey;
              }
              const resourceValue = meta.resource === 'classroom'
                ? normalizeClassroomText(line.classroom || entry.classroom)
                : text(line.teacher || entry.teacher);
              return (resourceValue || FALLBACK_RESOURCE) === boardKey;
            })
            .map((line) => {
              const columnValue = meta.daily
                ? ((meta.resource === 'classroom'
                  ? normalizeClassroomText(line.classroom || entry.classroom)
                  : text(line.teacher || entry.teacher)) || FALLBACK_RESOURCE)
                : line.day;
              const columnIndex = columnValues.indexOf(columnValue);
              if (columnIndex < 0) return null;

              const startSlot = Math.max(0, timeToSlotIndex(line.start, 9));
              const endSlot = Math.max(Math.min(timeToSlotIndex(line.end, 9), TIME_SLOTS.length), startSlot + 1);
              if (!Number.isFinite(startSlot) || !Number.isFinite(endSlot)) {
                return null;
              }

              const warningMessages = warningsByClassId.get(entry.classId) || [];
              return {
                key: `${entry.classId}-${line.id}-${surface}`,
                classId: entry.classId,
                lineId: line.id,
                columnIndex,
                startSlot,
                endSlot,
                backgroundColor: warningMessages.length ? 'rgba(245, 158, 11, 0.16)' : 'rgba(33, 110, 78, 0.12)',
                borderColor: warningMessages.length ? '#d97706' : '#216e4e',
                textColor: warningMessages.length ? '#92400e' : '#1f513d',
                title: stripClassPrefix(entry.className || '새 수업'),
                header: entry.subject ? `[${entry.subject}]` : '',
                detailLines: [
                  {
                    value: meta.resource === 'teacher'
                      ? normalizeClassroomText(line.classroom || entry.classroom) || '강의실 미정'
                      : text(line.teacher || entry.teacher) || '선생님 미정',
                  },
                ],
                editable: true,
                discardable: true,
                showResizeHandles: true,
                warning: warningMessages.length > 0,
              };
            })
            .filter(Boolean));

        return {
          boardKey,
          blocks,
          warningRanges: blocks.map((block) => ({
            columnIndex: block.columnIndex,
            startSlot: block.startSlot,
            endSlot: block.endSlot,
          })),
        };
      });
    } catch (error) {
      console.error('planner board build failed', error);
      return [];
    }
  }, [boardKeys, columnValues, draftEntries, meta.daily, meta.resource, surface, warningsByClassId]);

  const addDraft = () => {
    if (!draftName.trim()) {
      toast.info('배치할 수업명을 먼저 입력해 주세요.');
      return;
    }
    if (!selectedSubject.trim()) {
      toast.info('과목을 먼저 선택해 주세요.');
      return;
    }
    if (!draftTeacher.trim()) {
      toast.info('선생님은 필수입니다. 먼저 입력해 주세요.');
      return;
    }
    if (draftDay && !draftStart) {
      toast.info('요일을 입력했다면 시작 시간도 함께 선택해 주세요.');
      return;
    }
    pushHistorySnapshot();
    const entry = createDraftEntry(draftName, selectedSubject, periodInput, termInfo?.status || defaultStatus);
    const presetLine = buildPresetScheduleLine(draftDay, draftStart, draftEnd, draftTeacher, draftClassroom);
    const nextEntry = normalizeDraftEntry({
      ...entry,
      teacher: draftTeacher,
      classroom: draftClassroom,
      scheduleLines: presetLine ? [presetLine] : [],
    });
    setDraftEntries((current) => sanitizeDraftMap({ ...current, [entry.classId]: nextEntry }));
    setSelectedClassId(entry.classId);
    setDraftName('');
    setDraftDay('');
    setDraftStart('');
    setDraftEnd('');
  };

  const updateDraftEntry = (classId, patcher) => {
    const currentEntries = draftEntriesRef.current || {};
    const baseEntry = currentEntries[classId];
    if (!baseEntry) {
      return false;
    }

    const nextCandidate = typeof patcher === 'function' ? patcher(baseEntry) : { ...baseEntry, ...patcher };
    const nextEntry = normalizeDraftEntry({
      ...baseEntry,
      ...(nextCandidate || {}),
      scheduleLines: nextCandidate?.scheduleLines || baseEntry.scheduleLines || [],
    });
    if (!nextEntry) {
      return false;
    }

    const didChange = getDraftEntrySignature(baseEntry) !== getDraftEntrySignature(nextEntry);
    if (!didChange) {
      return false;
    }

    const historySnapshot = {
      entries: serializeDraftMap(currentEntries),
      selectedClassId: selectedClassIdRef.current || '',
    };
    const nextEntries = sanitizeDraftMap({
      ...currentEntries,
      [classId]: nextEntry,
    });

    draftEntriesRef.current = nextEntries;
    setHistoryStack((current) => [...current.slice(-19), historySnapshot]);
    setFutureStack([]);
    setDraftEntries(nextEntries);
    return true;
  };

  const handleUndo = () => {
    if (historyStack.length === 0) {
      toast.info('되돌릴 변경이 없습니다.');
      return;
    }

    const snapshot = historyStack[historyStack.length - 1];
    const currentSnapshot = {
      entries: serializeDraftMap(draftEntriesRef.current),
      selectedClassId: selectedClassIdRef.current || '',
    };
    setHistoryStack((current) => current.slice(0, -1));
    setFutureStack((current) => [...current.slice(-19), currentSnapshot]);
    setDraftEntries(sanitizeDraftMap(snapshot.entries));
    setSelectedClassId(snapshot.selectedClassId || Object.keys(snapshot.entries || {})[0] || '');
    setDraggingDraftId('');
    setExternalPreview(null);
    toast.success('마지막 변경을 되돌렸습니다.');
  };

  const handleRedo = () => {
    if (futureStack.length === 0) {
      toast.info('다시 적용할 변경이 없습니다.');
      return;
    }

    const snapshot = futureStack[futureStack.length - 1];
    const currentSnapshot = {
      entries: serializeDraftMap(draftEntriesRef.current),
      selectedClassId: selectedClassIdRef.current || '',
    };
    setFutureStack((current) => current.slice(0, -1));
    setHistoryStack((current) => [...current.slice(-19), currentSnapshot]);
    setDraftEntries(sanitizeDraftMap(snapshot.entries));
    setSelectedClassId(snapshot.selectedClassId || Object.keys(snapshot.entries || {})[0] || '');
    setDraggingDraftId('');
    setExternalPreview(null);
    toast.success('되돌린 변경을 다시 적용했습니다.');
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
      const isRedo = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && event.shiftKey)
        || (event.ctrlKey && event.key.toLowerCase() === 'y');
      if (!isUndo && !isRedo) {
        return;
      }

      const targetTag = String(event.target?.tagName || '').toLowerCase();
      const isTyping = ['input', 'textarea', 'select'].includes(targetTag) || event.target?.isContentEditable;
      if (isTyping) {
        return;
      }

      event.preventDefault();
      if (isRedo) {
        handleRedo();
        return;
      }
      handleUndo();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedo, handleUndo]);

  const resolveLocation = (boardKey, columnIndex, entry, line = {}) => {
    const columnValue = columnValues[columnIndex];
    if (!columnValue) return null;
    if (surface === 'classroom-weekly') return { day: columnValue, teacher: text(line.teacher || entry.teacher), classroom: boardKey };
    if (surface === 'teacher-weekly') return { day: columnValue, teacher: boardKey, classroom: normalizeClassroomText(line.classroom || entry.classroom) };
    if (surface === 'daily-classroom') return { day: boardKey, teacher: text(line.teacher || entry.teacher), classroom: columnValue };
    return { day: boardKey, teacher: columnValue, classroom: normalizeClassroomText(line.classroom || entry.classroom) };
  };

  const applyPlacement = (entry, line, boardKey, columnIndex, startSlot, endSlot, options = {}) => {
    try {
      const safeEntry = normalizeDraftEntry(entry);
      if (!safeEntry) return entry;

      const location = resolveLocation(boardKey, columnIndex, safeEntry, line);
      if (!location) return entry;

      const range = normalizePlacementRange(startSlot, endSlot, options.defaultDuration ?? DEFAULT_DROP_DURATION_SLOTS);
      const nextLine = {
        id: line?.id || createId('line'),
        day: location.day,
        start: safeTimeAt(range.startSlot, 'start'),
        end: safeTimeAt(Math.max(range.startSlot, range.endSlot - 1), 'end'),
        teacher: location.teacher || safeEntry.teacher,
        classroom: normalizeClassroomText(location.classroom || safeEntry.classroom),
      };

      const lines = line
        ? (safeEntry.scheduleLines || []).map((item) => (item.id === line.id ? nextLine : item))
        : [...(safeEntry.scheduleLines || []), nextLine];

      return {
        ...safeEntry,
        teacher: nextLine.teacher || safeEntry.teacher,
        classroom: nextLine.classroom || safeEntry.classroom,
        scheduleLines: lines,
      };
    } catch (error) {
      console.error('planner apply placement failed', error);
      return entry;
    }
  };

  const previewCopy = useMemo(() => {
    if (!draggingEntry || !externalPreview) {
      return '';
    }
    const location = resolveLocation(externalPreview.boardKey, externalPreview.columnIndex, draggingEntry);
    if (!location) {
      return '';
    }
    return `${location.day} · ${safeTimeAt(externalPreview.startRow, 'start')}-${safeTimeAt(Math.max(externalPreview.startRow, externalPreview.endRow - 1), 'end')} · ${location.teacher || '선생님 미정'} · ${location.classroom || '강의실 미정'}`;
  }, [draggingEntry, externalPreview]);

  const applyDraft = async () => {
    const entries = Object.values(draftEntries);
    if (entries.length === 0) {
      toast.info('적용할 배치 대상이 없습니다.');
      return;
    }
    if (entries.some((entry) => !entry.className?.trim() || !text(entry.teacher || unique(entry.scheduleLines.map((line) => text(line.teacher)))[0] || '') || entry.scheduleLines.length === 0)) {
      toast.error('수업명, 선생님, 시간표 배치가 모두 있어야 적용할 수 있습니다.');
      return;
    }

    setIsApplying(true);
    try {
      const persistedTerm = termInfo && !termInfo.localOnly && !termInfo.legacyOnly ? termInfo : null;
      for (const entry of entries) {
        const classroom = normalizeClassroomText(entry.classroom || unique(entry.scheduleLines.map((line) => normalizeClassroomText(line.classroom)))[0] || '');
        const teacher = text(entry.teacher || unique(entry.scheduleLines.map((line) => text(line.teacher)))[0] || '');
        const payload = {
          className: entry.className,
          name: entry.className,
          subject: entry.subject,
          teacher,
          classroom,
          room: classroom,
          schedule: buildScheduleString(entry),
          period: periodInput || entry.period,
          termId: persistedTerm?.id || null,
          term_id: persistedTerm?.id || null,
          status: normalizeClassStatus(entry.status) || PREPARING_CLASS_STATUS,
          startDate: persistedTerm?.startDate || persistedTerm?.start_date || entry.source?.startDate || '',
          endDate: persistedTerm?.endDate || persistedTerm?.end_date || entry.source?.endDate || '',
          studentIds: entry.source?.studentIds || [],
          waitlistIds: entry.source?.waitlistIds || [],
          textbookIds: entry.source?.textbookIds || [],
          textbookInfo: entry.source?.textbookInfo || '',
          lessons: entry.source?.lessons || [],
          capacity: entry.source?.capacity || 0,
          fee: entry.source?.fee || 0,
          grade: entry.source?.grade || '',
          schedulePlan: entry.source?.schedulePlan || null,
        };

        if (entry.isNew || String(entry.classId).startsWith('draft-')) {
          await dataService.addClass(payload);
        } else {
          await dataService.updateClass(entry.classId, payload);
        }
      }
      toast.success('배치 초안을 실제 시간표에 반영했습니다.');
    } catch (error) {
      toast.error(`배치 적용에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsApplying(false);
    }
  };

  const totalWarnings = [...warningsByClassId.values()].reduce((sum, items) => sum + items.length, 0);
  const emptyDraftState = Object.keys(draftEntries).length === 0;
  const emptyBoards = boardConfigs.length === 0;
  const teacherDatalistId = `planner-teachers-${surface}`;
  const classroomDatalistId = `planner-classrooms-${surface}`;

  return (
    <PlannerErrorBoundary resetKey={`${plannerKey}-${selectedClassId}-${Object.keys(draftEntries).length}`}>
      <div className="planner-surface">
        <div className="planner-shell">
          <div className="planner-top-grid">
            <div className="planner-panel planner-overview-panel">
              <div className="planner-title">{meta.title}</div>
              <div className="planner-copy">과목, 수업명, 선생님을 먼저 만들고 드래프트를 보드로 끌어다 놓거나 셀을 직접 드래그해 시간을 확정합니다. 강의실은 나중에 정해도 되고, 실행 취소/다시 실행으로 계속 조정한 뒤 마지막에만 적용합니다.</div>
              <div className="planner-inline-stats">
                <div className="planner-inline-stat"><span>미배치</span><strong>{unplacedCount}개</strong></div>
                <div className="planner-inline-stat"><span>배치 완료</span><strong>{placedCount}개</strong></div>
                <div className="planner-inline-stat"><span>경고</span><strong>{totalWarnings}건</strong></div>
              </div>
            </div>

            <div className="planner-panel planner-composer-panel">
              <div className="planner-form-grid">
                <label className="planner-field">
                  <span>과목 *</span>
                  <select className="styled-input" value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>
                    {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                </label>

                <label className="planner-field">
                  <span>수업명 *</span>
                  <input className="styled-input" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="예: 중1A, 고1 심화" />
                </label>

                <label className="planner-field">
                  <span>선생님 *</span>
                  <input
                    className="styled-input"
                    list={teacherDatalistId}
                    value={draftTeacher}
                    onChange={(event) => setDraftTeacher(text(event.target.value))}
                    placeholder="선생님 이름 입력"
                  />
                </label>

                <label className="planner-field">
                  <span>강의실</span>
                  <input
                    className="styled-input"
                    list={classroomDatalistId}
                    value={draftClassroom}
                    onChange={(event) => setDraftClassroom(normalizeClassroomText(event.target.value))}
                    placeholder="나중에 지정해도 됩니다"
                  />
                </label>
              </div>

              <div className="planner-time-grid">
                <label className="planner-field">
                  <span>요일</span>
                  <select className="styled-input" value={draftDay} onChange={(event) => setDraftDay(event.target.value)}>
                    <option value="">시간 미정</option>
                    {WORKDAYS.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </label>

                <label className="planner-field">
                  <span>시작</span>
                  <select className="styled-input" value={draftStart} onChange={(event) => setDraftStart(event.target.value)}>
                    <option value="">선택 안 함</option>
                    {startTimeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>

                <label className="planner-field">
                  <span>종료</span>
                  <select className="styled-input" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)}>
                    <option value="">비우면 2시간</option>
                    {endTimeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>

                <button type="button" className="action-pill planner-add-button" onClick={addDraft}>
                  <Plus size={16} />수업 추가
                </button>
              </div>

              <datalist id={teacherDatalistId}>
                {teacherOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              <datalist id={classroomDatalistId}>
                {classroomOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </div>

            <div className="planner-panel planner-selected-panel">
              <div className="planner-selected-heading">선택 수업</div>
              <div className="planner-selected-primary">
                <strong>{teacherSummary}</strong>
                <span>{selectedEntry ? stripClassPrefix(selectedEntry.className || '새 수업') : '수업을 선택해 주세요'}</span>
              </div>
              <div className="planner-selection-card">
                <div className="planner-selection-row">
                  <span>과목</span>
                  <strong>{selectedEntry?.subject || '과목 미정'}</strong>
                </div>
                <div className="planner-selection-row">
                  <span>요일/시간</span>
                  <strong>{scheduleLabel}</strong>
                </div>
                {selectedEntry ? (
                  <>
                    <label className="planner-field planner-selection-field">
                      <span>기본 선생님</span>
                      <input
                        className="styled-input"
                        list={teacherDatalistId}
                        value={selectedEntry.teacher || ''}
                        onChange={(event) => {
                          const nextTeacher = text(event.target.value);
                          updateDraftEntry(selectedEntry.classId, (entry) => ({
                            ...entry,
                            teacher: nextTeacher,
                            scheduleLines: (entry.scheduleLines || []).map((line) => ({
                              ...line,
                              teacher: !text(line.teacher) || text(line.teacher) === text(entry.teacher)
                                ? nextTeacher
                                : line.teacher,
                            })),
                          }));
                        }}
                        placeholder="선생님 입력"
                      />
                    </label>

                    <label className="planner-field planner-selection-field">
                      <span>기본 강의실</span>
                      <input
                        className="styled-input"
                        list={classroomDatalistId}
                        value={selectedEntry.classroom || ''}
                        onChange={(event) => {
                          const nextClassroom = normalizeClassroomText(event.target.value);
                          updateDraftEntry(selectedEntry.classId, (entry) => ({
                            ...entry,
                            classroom: nextClassroom,
                            scheduleLines: (entry.scheduleLines || []).map((line) => ({
                              ...line,
                              classroom: !normalizeClassroomText(line.classroom) || normalizeClassroomText(line.classroom) === normalizeClassroomText(entry.classroom)
                                ? nextClassroom
                                : line.classroom,
                            })),
                          }));
                        }}
                        placeholder="강의실 입력"
                      />
                    </label>
                  </>
                ) : (
                  <div className="planner-empty-copy">상단 드래프트를 선택한 뒤 보드의 빈 셀을 드래그하면 바로 배치됩니다.</div>
                )}
              </div>
            </div>
          </div>

          <div className="planner-panel planner-drafts-panel">
            <div className="planner-strip-header">
              <div>
                <div className="planner-list-title">배치 대상 목록</div>
                <div className="planner-strip-copy">드래프트 수업 카드를 바로 잡아 시간표 셀로 끌어다 놓을 수 있습니다.</div>
              </div>
            </div>
            {emptyDraftState ? (
              <div className="planner-empty-copy">수업을 먼저 추가해 주세요.</div>
            ) : (
              <div className="planner-draft-strip">
                {draftItems.map((entry) => {
                  const warningCount = warningsByClassId.get(entry.classId)?.length || 0;
                  const isPlaced = (entry.scheduleLines || []).length > 0;
                  return (
                    <button
                      key={entry.classId}
                      type="button"
                      draggable
                      className={`planner-draft-item ${entry.classId === selectedClassId ? 'is-active' : ''} ${draggingDraftId === entry.classId ? 'is-dragging' : ''}`}
                      onClick={() => setSelectedClassId(entry.classId)}
                      onDragStart={(event) => {
                        setSelectedClassId(entry.classId);
                        setDraggingDraftId(entry.classId);
                        setExternalPreview(null);
                        try {
                          event.dataTransfer.effectAllowed = 'copyMove';
                          event.dataTransfer.setData('text/plain', entry.classId);
                        } catch (error) {
                          console.warn('planner drag start failed', error);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingDraftId('');
                        setExternalPreview(null);
                      }}
                    >
                      <div className="planner-draft-head">
                        <span className={`planner-status-pill ${isPlaced ? 'is-placed' : 'is-unplaced'}`}>
                          {isPlaced ? `${entry.scheduleLines.length}개 블록` : '미배치'}
                        </span>
                        {warningCount > 0 ? <span className="planner-warning-pill"><AlertTriangle size={12} />{warningCount}</span> : null}
                        <span
                          className="planner-inline-icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            pushHistorySnapshot();
                            setDraftEntries((current) => {
                              const next = { ...current };
                              delete next[entry.classId];
                              return next;
                            });
                            setFutureStack([]);
                            if (selectedClassId === entry.classId) {
                              setSelectedClassId('');
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </span>
                      </div>
                      <div className="planner-draft-copy">
                        <strong>{text(entry.teacher) || '선생님 미정'}</strong>
                        <span className="planner-draft-name">{stripClassPrefix(entry.className || '새 수업')}</span>
                        <span>{entry.subject || '과목 미정'} · {normalizeClassroomText(entry.classroom) || '강의실 미정'}</span>
                        <span>{scheduleSummary(entry.scheduleLines) || '아직 배치되지 않았습니다.'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <section className="planner-main">
            <div className="planner-summary-bar">
              <div className="planner-summary-copy">
                <strong>
                  {draggingEntry
                    ? `${stripClassPrefix(draggingEntry.className)} 배치 중`
                    : selectedEntry
                      ? stripClassPrefix(selectedEntry.className)
                      : '배치할 수업을 선택해 주세요'}
                </strong>
                <span>
                  {draggingEntry
                    ? (previewCopy || '배치할 칸으로 끌어다 놓아 주세요.')
                    : selectedEntry
                      ? `${selectedEntry.subject || '과목 미정'} · ${scheduleSummary(selectedEntry.scheduleLines) || '시간 미정'} · 선생님 ${teacherSummary} · 강의실 ${classroomSummary}`
                      : '왼쪽 목록에서 수업을 선택한 뒤 빈 셀 클릭 또는 드래그 배치로 바로 시간을 잡을 수 있습니다.'}
                </span>
              </div>
              <div className="planner-summary-actions">
                <label className="planner-density">
                  <LayoutGrid size={16} />
                  <select value={density} onChange={(event) => setDensity(Number(event.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((option) => <option key={option} value={option}>{option}개</option>)}
                  </select>
                </label>
                <button type="button" className="action-chip" onClick={handleUndo} disabled={historyStack.length === 0}>
                  <RotateCcw size={16} />실행 취소
                </button>
                <button type="button" className="action-chip" onClick={handleRedo} disabled={futureStack.length === 0}>
                  <RotateCw size={16} />다시 실행
                </button>
                <button type="button" className="action-pill" onClick={applyDraft} disabled={isApplying}>
                  <Save size={16} />{isApplying ? '적용 중...' : '적용'}
                </button>
              </div>
            </div>

            {emptyDraftState ? (
              <div className="card-custom" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
                배치 대상 수업을 먼저 추가해 주세요.
              </div>
            ) : null}

            <div className="planner-board-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, density)}, minmax(460px, 1fr))` }}>
              {emptyBoards ? (
                <div className="card-custom" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  사용 가능한 배치 보드가 없습니다. 필터를 바꾸거나 리소스를 확인해 주세요.
                </div>
              ) : null}

              {boardConfigs.map(({ boardKey, blocks, warningRanges }) => (
                <section key={`${surface}-${boardKey}`} className="planner-board-card">
                  <header className="planner-board-header">
                    <strong>{boardKey}</strong>
                    <span>{blocks.length}개</span>
                  </header>
                  <TimetableGrid
                    columns={columnValues}
                    timeSlots={TIME_SLOTS}
                    blocks={blocks}
                    editable
                    editableMode="draft"
                    showResizeHandles
                    warningRanges={warningRanges}
                    externalDraggingDraft={draggingEntry ? {
                      classId: draggingEntry.classId,
                      durationSlots: DEFAULT_DROP_DURATION_SLOTS,
                      block: {
                        key: `${draggingEntry.classId}-external-preview`,
                        classId: draggingEntry.classId,
                        title: stripClassPrefix(draggingEntry.className || '새 수업'),
                        header: draggingEntry.subject ? `[${draggingEntry.subject}]` : '',
                        detailLines: [
                          {
                            value: meta.resource === 'teacher'
                              ? normalizeClassroomText(draggingEntry.classroom) || '강의실 미정'
                              : text(draggingEntry.teacher) || '선생님 미정',
                          },
                        ],
                        backgroundColor: 'rgba(33, 110, 78, 0.12)',
                        borderColor: '#216e4e',
                        textColor: '#1f513d',
                      },
                    } : null}
                    externalPreviewRange={externalPreview?.boardKey === boardKey ? externalPreview : null}
                    onExternalPreviewChange={(preview) => setExternalPreview(preview ? { boardKey, ...preview } : null)}
                    onDropDraftItem={({ classId, columnIndex, startSlot, endSlot }) => {
                      const entry = draftEntries[classId];
                      if (!entry) {
                        toast.info('배치할 수업을 다시 선택해 주세요.');
                        return;
                      }
                      try {
                        const changed = updateDraftEntry(classId, (current) => applyPlacement(current, null, boardKey, columnIndex, startSlot, endSlot));
                        setSelectedClassId(classId);
                        if (changed) {
                          toast.success('수업을 시간표에 배치했습니다.');
                        } else {
                          toast.info('변경된 배치가 없습니다.');
                        }
                      } catch (error) {
                        console.error('planner draft drop failed', error);
                        toast.error('수업 배치 중 오류가 발생했습니다.');
                      } finally {
                        setExternalPreview(null);
                        setDraggingDraftId('');
                      }
                    }}
                    onCreateSelection={({ columnIndex, startSlot, endSlot }) => {
                      if (!selectedEntry) {
                        toast.info('먼저 배치할 수업을 선택해 주세요.');
                        return;
                      }
                      try {
                        const changed = updateDraftEntry(
                          selectedEntry.classId,
                          (entry) => applyPlacement(entry, null, boardKey, columnIndex, startSlot, endSlot, { defaultDuration: 1 })
                        );
                        if (changed) {
                          toast.success('수업을 시간표에 배치했습니다.');
                        } else {
                          toast.info('변경된 배치가 없습니다.');
                        }
                      } catch (error) {
                        console.error('planner create selection failed', error);
                        toast.error('배치 중 오류가 발생했습니다.');
                      }
                    }}
                    onMoveBlock={({ block, columnIndex, startSlot }) => {
                      const entry = draftEntries[block.classId];
                      const line = entry?.scheduleLines?.find((item) => item.id === block.lineId);
                      if (!entry || !line) return;
                      try {
                        const changed = updateDraftEntry(
                          entry.classId,
                          (current) => applyPlacement(current, line, boardKey, columnIndex, startSlot, startSlot + (block.endSlot - block.startSlot))
                        );
                        if (!changed) {
                          toast.info('변경된 배치가 없습니다.');
                        }
                      } catch (error) {
                        console.error('planner move failed', error);
                        toast.error('배치 이동 중 오류가 발생했습니다.');
                      }
                    }}
                    onResizeBlock={({ block, startSlot, endSlot }) => {
                      try {
                        const changed = updateDraftEntry(block.classId, (entry) => ({
                          ...entry,
                          scheduleLines: (entry.scheduleLines || []).map((line) => line.id === block.lineId
                            ? { ...line, start: safeTimeAt(startSlot, 'start'), end: safeTimeAt(Math.max(startSlot, endSlot - 1), 'end') }
                            : line),
                        }));
                        if (!changed) {
                          toast.info('변경된 배치가 없습니다.');
                        }
                      } catch (error) {
                        console.error('planner resize failed', error);
                        toast.error('시간 조정 중 오류가 발생했습니다.');
                      }
                    }}
                    onDiscardBlock={({ block }) => {
                      try {
                        const changed = updateDraftEntry(block.classId, (entry) => ({
                          ...entry,
                          scheduleLines: (entry.scheduleLines || []).filter((line) => line.id !== block.lineId),
                        }));
                        if (changed) {
                          toast.info('배치를 취소했습니다.');
                        } else {
                          toast.info('변경된 배치가 없습니다.');
                        }
                      } catch (error) {
                        console.error('planner discard failed', error);
                        toast.error('배치 취소 중 오류가 발생했습니다.');
                      }
                    }}
                  />
                </section>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PlannerErrorBoundary>
  );
}
