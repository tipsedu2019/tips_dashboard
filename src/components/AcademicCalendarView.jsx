import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { academicEventSeeds, academicSchoolSeeds } from '../data/academicSeedData';
import { dataService as sharedDataService } from '../services/dataService';
import { useToast } from '../contexts/ToastContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import ConfirmDialog from './ui/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { detectAcademicWorkbookFormat, parseHighSchoolMatrixWorkbook } from '../lib/academicWorkbookUtils';
import { sortSubjectOptions } from '../lib/subjectUtils';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const CATEGORY_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'elementary', label: '초등' },
  { value: 'middle', label: '중등' },
  { value: 'high', label: '고등' },
];
const GRADE_OPTIONS = ['all', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const VIEW_OPTIONS = [
  { value: 'calendar', label: '달력 보기' },
  { value: 'timeline', label: '타임라인 보기' },
];
const DEFAULT_EVENT_TYPES = ['시험', '체험학습', '방학', '휴업일', '학원행사', '정기휴강'];
const DEFAULT_SUBJECTS = ['영어', '수학'];
const DEFAULT_COLOR = '#216e4e';
const REQUIRED_ACADEMIC_TABLES = [
  'academic_schools',
  'academic_curriculum_profiles',
  'academic_supplement_materials',
  'academic_exam_scopes',
  'academic_exam_days',
];

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function text(value) {
  return String(value || '').trim();
}

function schoolKey(value) {
  return text(value).replace(/\s+/g, '');
}

function normalizeCategory(value, grade = '') {
  const next = text(value).toLowerCase();
  if (['초등', 'elementary', '초'].includes(next)) return 'elementary';
  if (['중등', '중학교', 'middle', '중'].includes(next)) return 'middle';
  if (['고등', '고등학교', 'high', '고'].includes(next)) return 'high';
  if (String(grade).startsWith('초')) return 'elementary';
  if (String(grade).startsWith('중')) return 'middle';
  return 'high';
}

function defaultGrade(category) {
  if (category === 'elementary') return '초6';
  if (category === 'middle') return '중1';
  return '고1';
}

function normalizeGrade(value, category = 'high') {
  const next = text(value);
  if (!next || next === 'all' || next === '전체') return 'all';
  if (GRADE_OPTIONS.includes(next)) return next;
  if (next === 'g1' || next === '1학년') return defaultGrade(category);
  if (next === 'g2' || next === '2학년') return category === 'middle' ? '중2' : '고2';
  if (next === 'g3' || next === '3학년') return category === 'middle' ? '중3' : '고3';
  return next;
}

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find((item) => item.value === value)?.label || '고등';
}

function formatRange(start, end) {
  if (!start) return '-';
  if (!end || end === start) return start;
  return `${start} ~ ${end}`;
}

function normalizeDateRange(start, end) {
  if (!start && !end) {
    return { start: '', end: '' };
  }
  const safeStart = start || end;
  const safeEnd = end || start;
  return safeStart <= safeEnd
    ? { start: safeStart, end: safeEnd }
    : { start: safeEnd, end: safeStart };
}

function shiftDate(dateStr, amount) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().split('T')[0];
}

function diffDays(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  return Math.round((endDate - startDate) / 86400000);
}

function normalizeType(value) {
  const next = String(value || '');
  if (next.includes('시험')) return '시험';
  if (next.includes('체험') || next.includes('학습')) return '체험학습';
  if (next.includes('방학') || next.includes('개학')) return '방학';
  if (next.includes('휴업') || next.includes('기념')) return '휴업일';
  return next || '학사일정';
}

function buildSeedPayloads() {
  const schools = academicSchoolSeeds.map((school, index) => ({
    id: school.id,
    name: school.name,
    category: normalizeCategory(school.category),
    color: school.color || DEFAULT_COLOR,
    sortOrder: school.sortOrder ?? index,
    textbooks: school.textbooks || {},
  }));
  const schoolMap = Object.fromEntries(schools.map((school) => [school.id, school]));
  const events = academicEventSeeds.map((event) => ({
    ...event,
    school: schoolMap[event.schoolId]?.name || event.school || '',
    color: schoolMap[event.schoolId]?.color || event.color || DEFAULT_COLOR,
    type: normalizeType(event.type),
    end: event.end || event.start,
    grade: normalizeGrade(event.grade, schoolMap[event.schoolId]?.category || 'high'),
  }));
  return { schools, events };
}

function formatMissingTables(missingTables = []) {
  return missingTables.length > 0 ? missingTables.join(', ') : REQUIRED_ACADEMIC_TABLES.join(', ');
}

function createStableImportId(...parts) {
  const source = parts.map((part) => text(part)).join('|') || 'tips-dashboard';
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ (code + index), 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ (code * 31), 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ (code + hashes[0]), 668265263);
  }

  const hexChars = hashes
    .map((value) => (value >>> 0).toString(16).padStart(8, '0'))
    .join('')
    .slice(0, 32)
    .split('');

  hexChars[12] = '4';
  hexChars[16] = ((parseInt(hexChars[16], 16) & 0x3) | 0x8).toString(16);

  const hex = hexChars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createEmptyEvent(dateStr, school) {
  const today = new Date().toISOString().split('T')[0];
  return {
    title: '',
    schoolId: school?.id || '',
    school: school?.name || '',
    type: DEFAULT_EVENT_TYPES[0],
    grade: defaultGrade(school?.category || 'high'),
    note: '',
    start: dateStr || today,
    end: dateStr || today,
    color: school?.color || DEFAULT_COLOR,
  };
}

function Section({ title, description, action, children }) {
  return (
    <div className="card" style={{ padding: 20, marginBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14, alignItems: 'start' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h3>
          {description && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function AcademicCalendarView({ data, dataService = sharedDataService }) {
  const toast = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const { isStaff, isTeacher } = useAuth();
  const canEdit = isStaff || isTeacher;
  const canUpload = isStaff;
  const canManageSchoolMeta = isStaff;
  const uploadRef = useRef(null);

  const [currentDate, setCurrentDate] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSchoolId, setSelectedSchoolId] = useState('all');
  const [selectedGradeFilter, setSelectedGradeFilter] = useState('all');
  const [selectedTypes, setSelectedTypes] = useState(DEFAULT_EVENT_TYPES);
  const [viewMode, setViewMode] = useState('calendar');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [schoolDraft, setSchoolDraft] = useState({ id: '', name: '', category: 'high', color: DEFAULT_COLOR, sortOrder: 0 });
  const [profileDraft, setProfileDraft] = useState({ id: '', grade: '고1', subject: '영어', mainTextbookTitle: '', mainTextbookPublisher: '', note: '' });
  const [supplementsDraft, setSupplementsDraft] = useState([]);
  const [examScopesDraft, setExamScopesDraft] = useState([]);
  const [examDaysDraft, setExamDaysDraft] = useState([]);
  const [selectedProfileGrade, setSelectedProfileGrade] = useState('고1');
  const [selectedProfileSubject, setSelectedProfileSubject] = useState('영어');
  const [isBusy, setIsBusy] = useState(false);
  const [workspaceSupport, setWorkspaceSupport] = useState({ ready: true, missingTables: [], checkedAt: null });
  const [calendarSelection, setCalendarSelection] = useState(null);
  const [draggedEventId, setDraggedEventId] = useState(null);

  const schools = useMemo(() => [...(data?.academicSchools || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, 'ko')), [data?.academicSchools]);
  const schoolMap = useMemo(() => Object.fromEntries(schools.map((school) => [school.id, school])), [schools]);
  const selectedSchool = useMemo(() => schools.find((school) => school.id === selectedSchoolId) || null, [schools, selectedSchoolId]);

  const events = useMemo(() => (data?.academicEvents || []).map((event) => {
    const school = schoolMap[event.schoolId];
    return {
      ...event,
      schoolId: event.schoolId || school?.id || '',
      school: school?.name || event.school || '',
      color: school?.color || event.color || DEFAULT_COLOR,
      type: normalizeType(event.type),
      end: event.end || event.start,
      grade: normalizeGrade(event.grade, school?.category || 'high'),
      note: event.note || '',
    };
  }), [data?.academicEvents, schoolMap]);

  const profiles = data?.academicCurriculumProfiles || [];
  const materials = data?.academicSupplementMaterials || [];
  const scopes = data?.academicExamScopes || [];
  const examDays = data?.academicExamDays || [];

  const studentSchoolCatalog = useMemo(() => {
    const buckets = new Map();

    (data?.students || []).forEach((student) => {
      const name = text(student.school);
      if (!name) {
        return;
      }

      const grades = buckets.get(name) || new Set();
      if (student.grade) {
        grades.add(text(student.grade));
      }
      buckets.set(name, grades);
    });

    return [...buckets.entries()].map(([name, grades]) => ({
      name,
      grades: [...grades].filter(Boolean).sort((left, right) => left.localeCompare(right, 'ko')),
      category: normalizeCategory('', [...grades][0] || ''),
    }));
  }, [data?.students]);

  const subjectOptions = useMemo(
    () => sortSubjectOptions([...DEFAULT_SUBJECTS, ...profiles.map((profile) => profile.subject).filter(Boolean)]),
    [profiles]
  );
  const eventTypes = useMemo(() => [...new Set([...DEFAULT_EVENT_TYPES, ...events.map((event) => event.type)].filter(Boolean))], [events]);
  const visibleSchools = useMemo(() => selectedCategory === 'all' ? schools : schools.filter((school) => school.category === selectedCategory), [schools, selectedCategory]);
  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return events.filter((event) => {
      const school = schoolMap[event.schoolId];
      const matchesCategory = selectedCategory === 'all' || school?.category === selectedCategory;
      const matchesSchool = selectedSchoolId === 'all' || event.schoolId === selectedSchoolId;
      const matchesGrade = selectedGradeFilter === 'all' || event.grade === 'all' || event.grade === selectedGradeFilter;
      const matchesType = selectedTypes.length === 0 || selectedTypes.includes(event.type);
      const matchesQuery = !query || `${event.title} ${event.school} ${event.note} ${event.type}`.toLowerCase().includes(query);
      return matchesCategory && matchesSchool && matchesGrade && matchesType && matchesQuery;
    }).sort((a, b) => `${a.start}${a.end}`.localeCompare(`${b.start}${b.end}`));
  }, [events, schoolMap, searchQuery, selectedCategory, selectedSchoolId, selectedGradeFilter, selectedTypes]);

  const currentProfile = useMemo(() => selectedSchool ? profiles.find((profile) => profile.schoolId === selectedSchool.id && profile.grade === selectedProfileGrade && profile.subject === selectedProfileSubject) || null : null, [profiles, selectedSchool, selectedProfileGrade, selectedProfileSubject]);
  const currentMaterials = useMemo(() => currentProfile ? materials.filter((item) => item.profileId === currentProfile.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [], [currentProfile, materials]);
  const currentScopes = useMemo(() => currentProfile ? scopes.filter((item) => item.profileId === currentProfile.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [], [currentProfile, scopes]);
  const currentExamDays = useMemo(
    () => selectedSchool ? examDays.filter((item) => item.schoolId === selectedSchool.id && item.grade === selectedProfileGrade).sort((a, b) => `${a.examDate}${a.subject}`.localeCompare(`${b.examDate}${b.subject}`)) : [],
    [examDays, selectedProfileGrade, selectedSchool]
  );
  const schoolEvents = useMemo(() => selectedSchool ? events.filter((event) => event.schoolId === selectedSchool.id).sort((a, b) => `${a.start}${a.end}`.localeCompare(`${b.start}${b.end}`)) : [], [events, selectedSchool]);
  const availableGradeOptions = useMemo(() => {
    if (!selectedSchool) {
      return GRADE_OPTIONS.filter((grade) => grade !== 'all');
    }

    const studentMatched = studentSchoolCatalog.find((item) => schoolKey(item.name) === schoolKey(selectedSchool.name));
    if (studentMatched?.grades?.length) {
      return studentMatched.grades;
    }

    const profileGrades = [...new Set(profiles.filter((profile) => profile.schoolId === selectedSchool.id).map((profile) => profile.grade).filter(Boolean))];
    return profileGrades.length > 0 ? profileGrades.sort((left, right) => left.localeCompare(right, 'ko')) : GRADE_OPTIONS.filter((grade) => grade !== 'all');
  }, [profiles, selectedSchool, studentSchoolCatalog]);

  const calendarMeta = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = Array.from({ length: firstDay.getDay() }, () => ({ day: null, fullDate: null }));
    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      days.push({ day, fullDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
    }
    while (days.length % 7 !== 0) days.push({ day: null, fullDate: null });
    return { days, monthLabel: `${year}년 ${month + 1}월` };
  }, [currentDate]);
  const timelineGroups = useMemo(() => filteredEvents.reduce((result, event) => {
    const key = (event.start || '').slice(0, 7) || '미정';
    if (!result[key]) result[key] = [];
    result[key].push(event);
    return result;
  }, {}), [filteredEvents]);

  useEffect(() => {
    if (!selectedSchool && schools.length > 0) setSelectedSchoolId(schools[0].id);
  }, [selectedSchool, schools]);

  useEffect(() => {
    let active = true;

    dataService.getAcademicWorkspaceSupport?.()
      .then((support) => {
        if (active && support) {
          setWorkspaceSupport(support);
        }
      })
      .catch(() => {
        if (active) {
          setWorkspaceSupport({ ready: true, missingTables: [], checkedAt: new Date() });
        }
      });

    return () => {
      active = false;
    };
  }, [dataService]);

  useEffect(() => {
    if (!canManageSchoolMeta || !dataService?.upsertAcademicSchools || studentSchoolCatalog.length === 0) {
      return;
    }

    const missingSchools = studentSchoolCatalog.filter((entry) => !schools.some((school) => schoolKey(school.name) === schoolKey(entry.name)));
    if (missingSchools.length === 0) {
      return;
    }

    let cancelled = false;
    dataService.upsertAcademicSchools(
      missingSchools.map((entry, index) => ({
        id: createId(),
        name: entry.name,
        category: entry.category || 'high',
        color: DEFAULT_COLOR,
        sortOrder: schools.length + index,
      }))
    ).catch(() => {
      if (!cancelled) {
        console.warn('[AcademicCalendarView] Failed to mirror student schools into academic_schools');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [canManageSchoolMeta, dataService, schools, studentSchoolCatalog]);

  useEffect(() => {
    if (!selectedSchool) {
      setSchoolDraft({ id: '', name: '', category: selectedCategory === 'all' ? 'high' : selectedCategory, color: DEFAULT_COLOR, sortOrder: schools.length });
      return;
    }
    setSchoolDraft({
      id: selectedSchool.id,
      name: selectedSchool.name,
      category: selectedSchool.category || 'high',
      color: selectedSchool.color || DEFAULT_COLOR,
      sortOrder: selectedSchool.sortOrder || 0,
    });
    if (
      !selectedProfileGrade ||
      selectedProfileGrade === 'all' ||
      (selectedSchool.category === 'middle' && selectedProfileGrade.startsWith('고')) ||
      (selectedSchool.category === 'high' && selectedProfileGrade.startsWith('중')) ||
      (selectedSchool.category === 'elementary' && !selectedProfileGrade.startsWith('초'))
    ) {
      setSelectedProfileGrade(defaultGrade(selectedSchool.category || 'high'));
    }
  }, [selectedCategory, selectedProfileGrade, selectedSchool, schools.length]);

  useEffect(() => {
    if (!selectedSchool) {
      return;
    }

    const availableSubjects = sortSubjectOptions(
      profiles
        .filter((profile) => profile.schoolId === selectedSchool.id)
        .map((profile) => profile.subject),
      { includeDefaults: true }
    );

    if (availableSubjects.length === 0) {
      return;
    }

    const nextSubject = availableSubjects.includes(selectedProfileSubject)
      ? selectedProfileSubject
      : availableSubjects[0];

    if (nextSubject !== selectedProfileSubject) {
      setSelectedProfileSubject(nextSubject);
      setProfileDraft((current) => ({ ...current, subject: nextSubject }));
    }
  }, [profiles, selectedProfileSubject, selectedSchool]);

  useEffect(() => {
    if (!currentProfile) {
      setProfileDraft((current) => ({ ...current, id: '', grade: selectedProfileGrade, subject: selectedProfileSubject, mainTextbookTitle: '', mainTextbookPublisher: '', note: '' }));
      setSupplementsDraft([]);
      setExamScopesDraft([]);
      setExamDaysDraft(currentExamDays.map((item, index) => ({ id: item.id, subject: item.subject || '영어', examDate: item.examDate || '', label: item.label || '', note: item.note || '', sortOrder: item.sortOrder ?? index })));
      return;
    }

    setProfileDraft({
      id: currentProfile.id,
      grade: currentProfile.grade,
      subject: currentProfile.subject,
      mainTextbookTitle: currentProfile.mainTextbookTitle || '',
      mainTextbookPublisher: currentProfile.mainTextbookPublisher || '',
      note: currentProfile.note || '',
    });
    setSupplementsDraft(currentMaterials.map((item, index) => ({ id: item.id, title: item.title || '', publisher: item.publisher || '', note: item.note || '', sortOrder: item.sortOrder ?? index })));
    setExamScopesDraft(currentScopes.map((item, index) => ({ id: item.id, academicEventId: item.academicEventId || '', periodLabel: item.periodLabel || '', textbookScope: item.textbookScope || '', supplementScope: item.supplementScope || '', otherScope: item.otherScope || '', note: item.note || '', sortOrder: item.sortOrder ?? index })));
    setExamDaysDraft(currentExamDays.map((item, index) => ({ id: item.id, subject: item.subject || '영어', examDate: item.examDate || '', label: item.label || '', note: item.note || '', sortOrder: item.sortOrder ?? index })));
  }, [currentExamDays, currentMaterials, currentProfile, currentScopes, selectedProfileGrade, selectedProfileSubject]);

  const dayEvents = (fullDate) => filteredEvents.filter((event) => fullDate && fullDate >= (event.start || event.date) && fullDate <= (event.end || event.start || event.date));
  const selectionRange = useMemo(
    () => (calendarSelection?.start ? normalizeDateRange(calendarSelection.start, calendarSelection.end) : null),
    [calendarSelection]
  );

  const openCreateModal = (startDate, endDate = startDate) => {
    const range = normalizeDateRange(startDate, endDate);
    setEditingEvent({
      ...createEmptyEvent(range.start, selectedSchool),
      start: range.start,
      end: range.end,
    });
  };

  const openEditModal = (event) => {
    setEditingEvent({ ...createEmptyEvent(event.start, schoolMap[event.schoolId]), ...event });
    setCalendarSelection(null);
  };

  const closeModal = () => {
    setEditingEvent(null);
    setCalendarSelection(null);
  };

  const beginCalendarSelection = useCallback((dateStr) => {
    if (!canEdit || !dateStr || draggedEventId) {
      return;
    }
    setCalendarSelection({ start: dateStr, end: dateStr });
  }, [canEdit, draggedEventId]);

  const updateCalendarSelection = useCallback((dateStr) => {
    if (!dateStr) {
      return;
    }
    setCalendarSelection((current) => (current?.start ? { ...current, end: dateStr } : current));
  }, []);

  const finishCalendarSelection = useCallback(() => {
    if (!calendarSelection?.start || draggedEventId) {
      return;
    }
    const range = normalizeDateRange(calendarSelection.start, calendarSelection.end);
    setCalendarSelection(null);
    openCreateModal(range.start, range.end);
  }, [calendarSelection, draggedEventId]);

  const moveCalendarEvent = useCallback(async (eventId, targetDate) => {
    if (!canEdit || !eventId || !targetDate) {
      return;
    }

    const targetEvent = events.find((item) => item.id === eventId);
    if (!targetEvent) {
      return;
    }

    const baseStart = targetEvent.start || targetEvent.date;
    const baseEnd = targetEvent.end || targetEvent.start || targetEvent.date;
    const offset = diffDays(baseStart, baseEnd);

    try {
      setIsBusy(true);
      await dataService.updateAcademicEvent(targetEvent.id, {
        ...targetEvent,
        start: targetDate,
        end: shiftDate(targetDate, offset),
      });
      if (editingEvent?.id === targetEvent.id) {
        setEditingEvent((current) => current ? { ...current, start: targetDate, end: shiftDate(targetDate, offset) } : current);
      }
      toast.success('학사일정을 이동했습니다.');
    } catch (error) {
      toast.error(`일정 이동에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setDraggedEventId(null);
      setIsBusy(false);
    }
  }, [canEdit, dataService, editingEvent?.id, events, toast]);

  useEffect(() => {
    if (!calendarSelection?.start) {
      return undefined;
    }

    const handleMouseUp = () => {
      finishCalendarSelection();
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [calendarSelection?.start, finishCalendarSelection]);
  const requireAcademicWorkspace = () => {
    if (workspaceSupport.ready) {
      return true;
    }

    toast.error(`학사일정 확장 테이블 설정이 필요합니다. SQL Editor에서 ${formatMissingTables(workspaceSupport.missingTables)} 테이블을 먼저 적용해 주세요.`);
    return false;
  };

  const saveEvent = async () => {
    if (!canEdit) return toast.info('읽기 전용 계정은 학사일정을 수정할 수 없습니다.');
    if (!text(editingEvent?.title)) return toast.error('일정 제목을 입력해 주세요.');
    if (!editingEvent.start || !editingEvent.end) return toast.error('시작일과 종료일을 모두 입력해 주세요.');
    if (editingEvent.end < editingEvent.start) return toast.error('종료일은 시작일보다 빠를 수 없습니다.');
    const school = schoolMap[editingEvent.schoolId] || null;
    const payload = { ...editingEvent, schoolId: school?.id || editingEvent.schoolId || '', school: school?.name || editingEvent.school || '', color: school?.color || editingEvent.color || DEFAULT_COLOR, grade: normalizeGrade(editingEvent.grade, school?.category || 'high'), type: normalizeType(editingEvent.type), note: editingEvent.note || '' };
    try {
      setIsBusy(true);
      if (editingEvent.id) {
        await dataService.updateAcademicEvent(editingEvent.id, payload);
        toast.success('학사일정을 수정했습니다.');
      } else {
        await dataService.addAcademicEvent(payload);
        toast.success('학사일정을 등록했습니다.');
      }
      closeModal();
    } catch (error) {
      toast.error(`학사일정 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const deleteEvent = async () => {
    if (!canEdit || !editingEvent?.id) return;
    const shouldDelete = await confirm({ title: '이 일정을 삭제할까요?', description: '삭제한 일정은 복구할 수 없습니다.', confirmLabel: '삭제', tone: 'danger' });
    if (!shouldDelete) return;
    try {
      setIsBusy(true);
      await dataService.deleteAcademicEvent(editingEvent.id);
      toast.success('학사일정을 삭제했습니다.');
      closeModal();
    } catch (error) {
      toast.error(`일정 삭제에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const saveSchool = async () => {
    if (!canManageSchoolMeta) return toast.info('학교 메타데이터는 staff/admin만 수정할 수 있습니다.');
    if (!text(schoolDraft.name)) return toast.error('학교명을 입력해 주세요.');
    if (!requireAcademicWorkspace()) return;
    setIsBusy(true);
    try {
      const [savedSchool] = await dataService.upsertAcademicSchools([{
        id: schoolDraft.id || createId(),
        name: text(schoolDraft.name),
        category: normalizeCategory(schoolDraft.category),
        color: schoolDraft.color || DEFAULT_COLOR,
        sortOrder: schoolDraft.sortOrder || schools.length,
        textbooks: selectedSchool?.textbooks || {},
      }]);
      if (savedSchool?.id) setSelectedSchoolId(savedSchool.id);
      toast.success(savedSchool?.id === selectedSchool?.id ? '학교 정보를 저장했습니다.' : '학교를 추가했습니다.');
    } catch (error) {
      toast.error(`학교 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const saveProfileBundle = async () => {
    if (!canEdit) return toast.info('읽기 전용 계정은 학사 공유 정보를 수정할 수 없습니다.');
    if (!selectedSchool) return toast.error('먼저 학교를 선택해 주세요.');
    if (!text(profileDraft.subject)) return toast.error('과목을 입력해 주세요.');
    if (!requireAcademicWorkspace()) return;
    setIsBusy(true);
    try {
      const [savedProfile] = await dataService.bulkUpsertAcademicCurriculumProfiles([{
        id: profileDraft.id || createId(),
        schoolId: selectedSchool.id,
        grade: selectedProfileGrade,
        subject: text(profileDraft.subject),
        mainTextbookTitle: text(profileDraft.mainTextbookTitle),
        mainTextbookPublisher: text(profileDraft.mainTextbookPublisher),
        note: text(profileDraft.note),
      }]);
      await dataService.replaceAcademicSupplementMaterials(savedProfile.id, supplementsDraft.map((item, index) => ({ ...item, sortOrder: index })));
      await dataService.replaceAcademicExamScopes(savedProfile.id, examScopesDraft.map((item, index) => ({ ...item, sortOrder: index })));
      await dataService.replaceAcademicExamDays(selectedSchool.id, selectedProfileGrade, examDaysDraft.map((item, index) => ({ ...item, sortOrder: index })));
      setSelectedProfileSubject(savedProfile.subject);
      setSelectedProfileGrade(savedProfile.grade);
      toast.success('학교별 학사 공유 정보를 저장했습니다.');
    } catch (error) {
      toast.error(`학사 공유 정보 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const importSeedData = async () => {
    if (!isStaff) return toast.info('내장 기본 데이터 불러오기는 staff/admin만 실행할 수 있습니다.');
    if (!requireAcademicWorkspace()) return;
    const shouldImport = await confirm({
      title: '내장 기본 데이터를 불러올까요?',
      description: '파일 업로드가 아니라 앱에 포함된 예시 학교와 일정을 Supabase에 저장합니다.',
      confirmLabel: '불러오기',
    });
    if (!shouldImport) return;
    const { schools: seedSchools, events: seedEvents } = buildSeedPayloads();
    setIsBusy(true);
    try {
      await dataService.upsertAcademicSchools(seedSchools);
      await dataService.bulkUpsertAcademicEvents(seedEvents);
      toast.success(`학교 ${seedSchools.length}개, 일정 ${seedEvents.length}개를 반영했습니다.`);
    } catch (error) {
      toast.error(`내장 기본 데이터 불러오기에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const sheets = [
        { name: '학교목록', rows: [{ 학교명: '예시고', 구분: '고등', 색상: '#216e4e', 정렬순서: 10 }] },
        { name: '교과정보', rows: [{ 학교명: '예시고', 학년: '고1', 과목: '영어', 교과서: '영어Ⅰ', 출판사: '비상', 비고: '1학기 공통' }] },
        { name: '부교재', rows: [{ 학교명: '예시고', 학년: '고1', 과목: '영어', 부교재: '영어 독해 기본서', 출판사: '좋은책', 비고: '', 순서: 1 }] },
        { name: '시험범위', rows: [{ 학교명: '예시고', 학년: '고1', 과목: '영어', 시험명: '1학기 중간고사', 연결일정ID: '', 교과서범위: '1과~2과', 부교재범위: '독해 1~3강', 기타범위: '학교 프린트 1회', 비고: '', 순서: 1 }] },
        { name: '시험당일', rows: [{ 학교명: '예시고', 학년: '고1', 과목: '영어', 시험일: '2026-04-24', 시험명: '1학기 중간고사', 비고: '' }] },
      ];
      sheets.forEach(({ name, rows }) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name));
      XLSX.writeFile(workbook, 'TIPS-학사데이터-업로드-템플릿.xlsx');
      toast.success('학사 데이터 업로드 템플릿을 저장했습니다.');
    } catch (error) {
      toast.error(`템플릿 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const uploadWorkbook = async (file) => {
    if (!canUpload) return toast.info('학사 데이터 업로드는 staff/admin만 사용할 수 있습니다.');
    if (!file) return;
    if (!requireAcademicWorkspace()) return;

    setIsBusy(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const format = detectAcademicWorkbookFormat(XLSX, workbook);
      const getRows = (sheetName) => (
        workbook.Sheets[sheetName]
          ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
          : []
      );

      let uploadPayload;

      if (format === 'matrix-high-school') {
        uploadPayload = parseHighSchoolMatrixWorkbook(XLSX, workbook);
      } else if (format === 'template') {
        uploadPayload = {
          schools: getRows('학교목록').map((row) => ({
            name: row.학교명 || row.school,
            category: row.구분 || row.category,
            color: row.색상 || row.color,
            sortOrder: Number(row.정렬순서 || row.sortOrder || 0),
          })),
          profiles: getRows('교과정보').map((row) => ({
            schoolName: row.학교명 || row.school,
            grade: row.학년 || row.grade,
            subject: row.과목 || row.subject,
            mainTextbookTitle: row.교과서 || row.main_textbook_title,
            mainTextbookPublisher: row.출판사 || row.publisher,
            note: row.비고 || row.note,
          })),
          materials: getRows('부교재').map((row, index) => ({
            schoolName: row.학교명 || row.school,
            grade: row.학년 || row.grade,
            subject: row.과목 || row.subject,
            title: row.부교재 || row.title,
            publisher: row.출판사 || row.publisher,
            note: row.비고 || row.note,
            sortOrder: Number(row.순서 || row.sortOrder || index),
          })),
          scopes: getRows('시험범위').map((row, index) => ({
            schoolName: row.학교명 || row.school,
            grade: row.학년 || row.grade,
            subject: row.과목 || row.subject,
            academicEventId: row.연결일정ID || row.academic_event_id,
            periodLabel: row.시험명 || row.period_label,
            textbookScope: row.교과서범위 || row.textbook_scope,
            supplementScope: row.부교재범위 || row.supplement_scope,
            otherScope: row.기타범위 || row.other_scope,
            note: row.비고 || row.note,
            sortOrder: Number(row.순서 || row.sortOrder || index),
          })),
          examDays: getRows('시험당일').map((row, index) => ({
            schoolName: row.학교명 || row.school,
            grade: row.학년 || row.grade,
            subject: row.과목 || row.subject,
            examDate: row.시험일 || row.exam_date,
            label: row.시험명 || row.label,
            note: row.비고 || row.note,
            sortOrder: Number(row.순서 || row.sortOrder || index),
          })),
          events: [],
          summary: { format: 'template' },
        };
      } else {
        throw new Error('지원하는 학사 업로드 형식이 아닙니다. 템플릿 4시트 파일이나 고등학교 원본 1시트 파일을 사용해 주세요.');
      }

      const schoolByName = new Map(schools.map((school) => [schoolKey(school.name), { id: school.id, name: school.name, category: school.category || 'high', color: school.color || DEFAULT_COLOR, sortOrder: school.sortOrder || 0 }]));
      const ensureSchool = (name, extra = {}) => {
        const key = schoolKey(name);
        if (!key) return null;
        const existing = schoolByName.get(key);
        const nextSchool = {
          id: existing?.id || createId(),
          name: text(name),
          category: normalizeCategory(extra.category || existing?.category, extra.grade || ''),
          color: extra.color || existing?.color || DEFAULT_COLOR,
          sortOrder: extra.sortOrder ?? existing?.sortOrder ?? schoolByName.size,
        };
        schoolByName.set(key, nextSchool);
        return nextSchool;
      };

      (uploadPayload.schools || []).forEach((school, index) => ensureSchool(school.name || school.schoolName, {
        category: school.category,
        color: school.color,
        sortOrder: school.sortOrder ?? index,
        grade: school.grade,
      }));
      [...(uploadPayload.profiles || []), ...(uploadPayload.materials || []), ...(uploadPayload.scopes || []), ...(uploadPayload.examDays || []), ...(uploadPayload.events || [])]
        .forEach((row) => ensureSchool(row.schoolName || row.school, {
          category: row.category,
          grade: row.grade,
        }));

      const savedSchools = await dataService.upsertAcademicSchools([...schoolByName.values()]);
      const savedSchoolByName = new Map(savedSchools.map((school) => [schoolKey(school.name), school]));
      const profileMap = new Map();
      const ensureProfile = (schoolName, grade, subject, extra = {}) => {
        const school = savedSchoolByName.get(schoolKey(schoolName));
        if (!school || !text(subject)) return null;
        const key = [school.id, normalizeGrade(grade, school.category), text(subject)].join('::');
        const existing = profileMap.get(key);
        profileMap.set(key, {
          id: existing?.id || createId(),
          schoolId: school.id,
          grade: normalizeGrade(grade, school.category),
          subject: text(subject),
          mainTextbookTitle: text(extra.mainTextbookTitle ?? existing?.mainTextbookTitle),
          mainTextbookPublisher: text(extra.mainTextbookPublisher ?? existing?.mainTextbookPublisher),
          note: text(extra.note ?? existing?.note),
        });
        return key;
      };

      (uploadPayload.profiles || []).forEach((row) => ensureProfile(row.schoolName || row.school, row.grade, row.subject, {
        mainTextbookTitle: row.mainTextbookTitle || row.main_textbook_title,
        mainTextbookPublisher: row.mainTextbookPublisher || row.publisher,
        note: row.note,
      }));

      const materialBuckets = new Map();
      (uploadPayload.materials || []).forEach((row, index) => {
        const key = ensureProfile(row.schoolName || row.school, row.grade, row.subject);
        if (!key || !text(row.title || row.부교재)) return;
        const items = materialBuckets.get(key) || [];
        items.push({
          id: createStableImportId('material', key, row.title || row.부교재, row.publisher, row.note, row.sortOrder ?? index),
          title: text(row.title || row.부교재),
          publisher: text(row.publisher || row.출판사),
          note: text(row.note || row.비고),
          sortOrder: row.sortOrder ?? index,
        });
        materialBuckets.set(key, items);
      });

      const scopeBuckets = new Map();
      (uploadPayload.scopes || []).forEach((row, index) => {
        const key = ensureProfile(row.schoolName || row.school, row.grade, row.subject);
        if (!key) return;
        const items = scopeBuckets.get(key) || [];
        items.push({
          id: createStableImportId('scope', key, row.periodLabel || row.시험명, row.academicEventId || row.연결일정ID, row.textbookScope, row.supplementScope, row.otherScope, row.note, row.sortOrder ?? index),
          academicEventId: text(row.academicEventId || row.연결일정ID),
          periodLabel: text(row.periodLabel || row.시험명),
          textbookScope: text(row.textbookScope || row.교과서범위),
          supplementScope: text(row.supplementScope || row.부교재범위),
          otherScope: text(row.otherScope || row.기타범위),
          note: text(row.note || row.비고),
          sortOrder: row.sortOrder ?? index,
        });
        scopeBuckets.set(key, items);
      });

      const examDayBuckets = new Map();
      (uploadPayload.examDays || []).forEach((row, index) => {
        const school = savedSchoolByName.get(schoolKey(row.schoolName || row.school));
        if (!school || !text(row.grade) || !text(row.subject) || !text(row.examDate)) return;
        const bucketKey = `${school.id}::${text(row.grade)}`;
        const items = examDayBuckets.get(bucketKey) || [];
        items.push({
          id: createStableImportId('exam-day', school.id, row.grade, row.subject, row.examDate, row.label, row.sortOrder ?? index),
          subject: text(row.subject),
          examDate: text(row.examDate),
          label: text(row.label || row.시험명),
          note: text(row.note || row.비고),
          sortOrder: row.sortOrder ?? index,
        });
        examDayBuckets.set(bucketKey, items);
      });

      const savedProfiles = await dataService.bulkUpsertAcademicCurriculumProfiles([...profileMap.values()]);
      const savedProfileByKey = new Map(savedProfiles.map((profile) => [[profile.schoolId, profile.grade, profile.subject].join('::'), profile]));
      for (const [key, items] of materialBuckets.entries()) {
        const profile = savedProfileByKey.get(key);
        if (profile) await dataService.replaceAcademicSupplementMaterials(profile.id, items);
      }
      for (const [key, items] of scopeBuckets.entries()) {
        const profile = savedProfileByKey.get(key);
        if (profile) await dataService.replaceAcademicExamScopes(profile.id, items);
      }
      for (const [bucketKey, items] of examDayBuckets.entries()) {
        const [schoolId, grade] = bucketKey.split('::');
        await dataService.replaceAcademicExamDays(schoolId, grade, items);
      }

      const eventRows = (uploadPayload.events || [])
        .map((event) => {
          const school = savedSchoolByName.get(schoolKey(event.schoolName || event.school));
          if (!school || !text(event.title) || !event.start) {
            return null;
          }

          const grade = normalizeGrade(event.grade, school.category || 'high');
          const existingEvent = events.find((item) => (
            item.schoolId === school.id &&
            normalizeGrade(item.grade, school.category || 'high') === grade &&
            normalizeType(item.type) === normalizeType(event.type) &&
            text(item.title) === text(event.title) &&
            item.start === event.start &&
            (item.end || item.start) === (event.end || event.start)
          ));

          return {
            id: existingEvent?.id || createStableImportId('event', school.id, grade, normalizeType(event.type), event.title, event.start, event.end || event.start),
            title: text(event.title),
            schoolId: school.id,
            school: school.name,
            type: normalizeType(event.type),
            start: event.start,
            end: event.end || event.start,
            grade,
            color: school.color || DEFAULT_COLOR,
            note: text(event.note),
          };
        })
        .filter(Boolean);

      if (eventRows.length > 0) {
        await dataService.bulkUpsertAcademicEvents(eventRows);
      }

      const supplementCount = [...materialBuckets.values()].reduce((sum, items) => sum + items.length, 0);
      const examDayCount = [...examDayBuckets.values()].reduce((sum, items) => sum + items.length, 0);
      const uploadLabel = format === 'matrix-high-school' ? '고등학교 운영 원본' : '템플릿';
      toast.success(
        `${uploadLabel} 업로드 완료: 학교 ${savedSchools.length}개, 교과 정보 ${savedProfiles.length}개, 부교재 ${supplementCount}개, 일정 ${eventRows.length}개, 시험일 ${examDayCount}개`
      );
    } catch (error) {
      toast.error(`학사 데이터 업로드에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><CalendarIcon size={28} /> 통합 학사 일정</h1>
          <p>학교별 일정과 학년·과목별 교과서, 부교재, 시험범위를 한 화면에서 관리합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={downloadTemplate} style={{ gap: 8 }}><Download size={18} /> 템플릿 다운로드</button>
          <button
            className="btn btn-secondary"
            onClick={() => uploadRef.current?.click()}
            disabled={!canUpload || isBusy}
            style={{ gap: 8 }}
            title={canUpload ? '엑셀 템플릿이나 운영 원본 파일을 업로드합니다.' : '학사 데이터 업로드는 staff/admin만 사용할 수 있습니다.'}
          >
            <Upload size={18} /> 학사 데이터 업로드
          </button>
          {isStaff && <button className="btn btn-secondary" onClick={importSeedData} disabled={isBusy} style={{ gap: 8 }}><Download size={18} /> 내장 기본 데이터 불러오기</button>}
          {canEdit && <button className="btn btn-primary" onClick={() => openCreateModal()} style={{ gap: 8 }}><Plus size={18} /> 일정 추가</button>}
        </div>
      </div>

      <input ref={uploadRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(event) => uploadWorkbook(event.target.files?.[0])} />

      {!workspaceSupport.ready && (
        <div
          className="card"
          style={{
            padding: 18,
            border: '1px solid rgba(245, 158, 11, 0.28)',
            background: 'rgba(245, 158, 11, 0.06)',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e' }}>학사일정 확장 테이블 설정 필요</div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7, color: '#92400e' }}>
            학교·학년·과목별 교과서, 부교재, 시험범위 저장과 학사 데이터 업로드를 쓰려면 Supabase SQL Editor에서 확장 테이블을 먼저 적용해 주세요.
            <br />
            필요한 테이블: {formatMissingTables(workspaceSupport.missingTables)}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(360px, 420px)', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface-hover)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{calendarMeta.monthLabel}</h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>현재 필터 기준 일정 {filteredEvents.length}개</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-icon" onClick={() => setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}><ChevronLeft size={20} /></button>
                <button className="btn-icon" onClick={() => setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}><ChevronRight size={20} /></button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                <Search size={16} style={{ color: 'var(--text-muted)' }} />
                <input type="text" placeholder="학교명, 일정명, 메모 검색" style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%' }} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              </div>
              <div className="h-segment-container" style={{ flexWrap: 'wrap' }}>{VIEW_OPTIONS.map((option) => <button key={option.value} type="button" className={`h-segment-btn ${viewMode === option.value ? 'active' : ''}`} onClick={() => setViewMode(option.value)}>{option.label}</button>)}</div>
              <div className="h-segment-container" style={{ flexWrap: 'wrap' }}>{CATEGORY_OPTIONS.map((option) => <button key={option.value} type="button" className={`h-segment-btn ${selectedCategory === option.value ? 'active' : ''}`} onClick={() => setSelectedCategory(option.value)}>{option.label}</button>)}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <select className="styled-input" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>
                <option value="all">전체 학교</option>
                {visibleSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
              <div className="h-segment-container" style={{ flexWrap: 'wrap' }}>{GRADE_OPTIONS.map((grade) => <button key={grade} type="button" className={`h-segment-btn ${selectedGradeFilter === grade ? 'active' : ''}`} onClick={() => setSelectedGradeFilter(grade)}>{grade === 'all' ? '전체' : grade}</button>)}</div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{eventTypes.map((type) => {
              const active = selectedTypes.includes(type);
              return <button key={type} type="button" onClick={() => setSelectedTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])} style={{ padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: '1px solid var(--border-color)', background: active ? 'var(--accent-color)' : 'var(--bg-surface)', color: active ? '#fff' : 'var(--text-secondary)' }}>{type}</button>;
            })}</div>
          </div>

          <div style={{ padding: 20 }}>
            {viewMode === 'calendar' ? (
              <div className="calendar-grid-frame">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))', background: 'var(--border-color)', gap: 1, minWidth: 800 }}>
                  {WEEKDAY_LABELS.map((label, index) => <div key={label} style={{ padding: 12, textAlign: 'center', background: 'var(--bg-surface-hover)', fontSize: 12, fontWeight: 800, color: index === 0 ? '#ef4444' : index === 6 ? '#2563eb' : 'var(--text-secondary)' }}>{label}</div>)}
                  {calendarMeta.days.map((day, index) => {
                    const items = dayEvents(day.fullDate);
                    const today = new Date().toISOString().split('T')[0];
                    const isToday = day.fullDate === today;
                    const weekend = index % 7 === 0 || index % 7 === 6;
                    return (
                      <div key={`${day.fullDate || 'empty'}-${index}`} className="calendar-day-cell" onClick={() => canEdit && day.fullDate && openCreateModal(day.fullDate)} style={{ minHeight: 128, padding: 10, background: 'var(--bg-surface)', border: isToday ? '2px solid var(--accent-color)' : 'none', cursor: day.day && canEdit ? 'pointer' : 'default' }}>
                        {day.day ? <>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: weekend ? (index % 7 === 0 ? '#ef4444' : '#2563eb') : 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{day.day}</span>{isToday && <span style={{ fontSize: 10, background: 'var(--accent-color)', color: '#fff', padding: '2px 6px', borderRadius: 999 }}>오늘</span>}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{items.map((event) => <button key={event.id} type="button" title={`${event.school}: ${event.title}`} onClick={(clickEvent) => { clickEvent.stopPropagation(); openEditModal(event); }} className="calendar-event-pill" style={{ fontSize: 11, padding: '5px 8px', borderRadius: 8, background: `${event.color || DEFAULT_COLOR}20`, color: event.color || DEFAULT_COLOR, border: 'none', borderLeft: `3px solid ${event.color || DEFAULT_COLOR}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, textAlign: 'left' }}>{event.school && <span style={{ opacity: 0.72, marginRight: 4 }}>[{event.school}]</span>}{event.title}</button>)}</div>
                        </> : <div style={{ minHeight: 100, opacity: 0.3 }} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Object.keys(timelineGroups).length === 0 && <div className="card-custom" style={{ padding: 20, fontSize: 13, color: 'var(--text-secondary)' }}>표시할 일정이 없습니다.</div>}
                {Object.entries(timelineGroups).sort(([left], [right]) => left.localeCompare(right)).map(([month, items]) => <section key={month} className="card-custom" style={{ padding: 20 }}><h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>{month.replace('-', '년 ')}월</h3><div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map((event) => <button key={event.id} type="button" onClick={() => openEditModal(event)} className="card-custom" style={{ padding: 14, border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 12, alignItems: 'center', textAlign: 'left' }}><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{formatRange(event.start, event.end)}</div><div><div style={{ fontWeight: 700 }}>{event.title}</div><div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>{event.school || '학교 미지정'} · {event.type}</div>{event.note && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{event.note}</div>}</div><span style={{ padding: '4px 10px', borderRadius: 999, background: `${event.color || DEFAULT_COLOR}20`, color: event.color || DEFAULT_COLOR, fontSize: 12, fontWeight: 700 }}>{event.type}</span></button>)}</div></section>)}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="업로드 안내" description="5시트 템플릿 XLSX와 고등학교 원본 1시트 XLSX를 모두 지원합니다. 내장 기본 데이터 불러오기는 파일 업로드가 아니라 앱에 포함된 예시 학교/일정을 Supabase에 저장하는 기능입니다.">
            <div className="card-custom" style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }}>
              <div>1. 학교목록: 학교명, 구분, 색상, 정렬순서</div>
              <div>2. 교과정보: 학교명, 학년, 과목, 교과서, 출판사, 비고</div>
              <div>3. 부교재: 학교명, 학년, 과목, 부교재, 출판사, 비고, 순서</div>
              <div>4. 시험범위: 학교명, 학년, 과목, 시험명, 연결 일정 ID, 교과서 범위, 부교재 범위, 기타 범위, 비고, 순서</div>
              <div>5. 시험당일: 학교명, 학년, 과목, 시험일, 시험명, 비고</div>
              <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>고등학교 운영 원본 1시트 파일은 학교/고1/고2/고3/시험기간/수학여행/방학·기타일정 구조를 자동 인식해 가져옵니다.</div>
            </div>
          </Section>

          <Section title="학교 선택 및 추가" description="학교를 선택하거나 새 학교를 바로 추가할 수 있습니다." action={canManageSchoolMeta ? <button type="button" className="btn-secondary" onClick={() => { setSelectedSchoolId('all'); setSchoolDraft({ id: '', name: '', category: selectedCategory === 'all' ? 'high' : selectedCategory, color: DEFAULT_COLOR, sortOrder: schools.length }); }}><Plus size={16} /> 새 학교</button> : null}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <select className="styled-input" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>
                <option value="all">학교 선택</option>
                {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.7fr', gap: 12 }}>
                <input className="styled-input" placeholder="학교명" value={schoolDraft.name} onChange={(event) => setSchoolDraft((current) => ({ ...current, name: event.target.value }))} disabled={!canManageSchoolMeta} />
                <select className="styled-input" value={schoolDraft.category} onChange={(event) => setSchoolDraft((current) => ({ ...current, category: event.target.value }))} disabled={!canManageSchoolMeta}>{CATEGORY_OPTIONS.filter((option) => option.value !== 'all').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                <input type="color" className="styled-input" value={schoolDraft.color || DEFAULT_COLOR} onChange={(event) => setSchoolDraft((current) => ({ ...current, color: event.target.value }))} disabled={!canManageSchoolMeta} style={{ padding: 6 }} />
              </div>
              {selectedSchool && <div className="card-custom" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div><div style={{ fontWeight: 700 }}>{selectedSchool.name}</div><div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>{categoryLabel(selectedSchool.category)} · 일정 {schoolEvents.length}개</div></div><div style={{ width: 18, height: 18, borderRadius: 999, background: selectedSchool.color || DEFAULT_COLOR }} /></div>}
              {canManageSchoolMeta && <button type="button" className="btn-primary" onClick={saveSchool} disabled={isBusy}><Save size={16} /> 학교 저장</button>}
            </div>
          </Section>

          <Section title="학교·학년·과목별 공유 정보" description="교과서, 부교재, 시험범위를 선생님들이 함께 업데이트할 수 있습니다.">
            {!selectedSchool ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>먼저 학교를 선택해 주세요.</div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <select className="styled-input" value={selectedProfileGrade} onChange={(event) => setSelectedProfileGrade(event.target.value)}>{availableGradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="styled-input" value={selectedProfileSubject} onChange={(event) => { setSelectedProfileSubject(event.target.value); setProfileDraft((current) => ({ ...current, subject: event.target.value })); }}>{subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select>
                  {canEdit && <button type="button" className="btn-secondary" onClick={() => { const next = window.prompt('새 과목명을 입력해 주세요.', ''); if (text(next)) { setSelectedProfileSubject(text(next)); setProfileDraft((current) => ({ ...current, subject: text(next) })); } }}>추가</button>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input className="styled-input" placeholder="교과서" value={profileDraft.mainTextbookTitle} onChange={(event) => setProfileDraft((current) => ({ ...current, grade: selectedProfileGrade, subject: selectedProfileSubject, mainTextbookTitle: event.target.value }))} disabled={!canEdit} />
                <input className="styled-input" placeholder="출판사" value={profileDraft.mainTextbookPublisher} onChange={(event) => setProfileDraft((current) => ({ ...current, mainTextbookPublisher: event.target.value }))} disabled={!canEdit} />
              </div>
              <textarea className="styled-input" placeholder="공유 메모" value={profileDraft.note} onChange={(event) => setProfileDraft((current) => ({ ...current, note: event.target.value }))} disabled={!canEdit} style={{ minHeight: 78, resize: 'vertical' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>부교재</strong>{canEdit && <button type="button" className="btn-secondary" onClick={() => setSupplementsDraft((current) => [...current, { id: createId(), title: '', publisher: '', note: '', sortOrder: current.length }])}><Plus size={16} /> 추가</button>}</div>
              {supplementsDraft.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>등록된 부교재가 없습니다.</div>}
              {supplementsDraft.map((item) => <div key={item.id} className="card-custom" style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'start' }}><input className="styled-input" placeholder="부교재명" value={item.title} onChange={(event) => setSupplementsDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry))} disabled={!canEdit} /><input className="styled-input" placeholder="출판사" value={item.publisher} onChange={(event) => setSupplementsDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, publisher: event.target.value } : entry))} disabled={!canEdit} />{canEdit && <button type="button" className="btn-icon" style={{ color: '#ef4444', marginTop: 6 }} onClick={() => setSupplementsDraft((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={16} /></button>}<textarea className="styled-input" placeholder="비고" value={item.note} onChange={(event) => setSupplementsDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, note: event.target.value } : entry))} disabled={!canEdit} style={{ gridColumn: '1 / span 2', minHeight: 64, resize: 'vertical' }} /></div>)}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>시험기간별 시험범위</strong>{canEdit && <button type="button" className="btn-secondary" onClick={() => setExamScopesDraft((current) => [...current, { id: createId(), academicEventId: '', periodLabel: '', textbookScope: '', supplementScope: '', otherScope: '', note: '', sortOrder: current.length }])}><Plus size={16} /> 추가</button>}</div>
              {examScopesDraft.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>등록된 시험범위가 없습니다.</div>}
              {examScopesDraft.map((item) => <div key={item.id} className="card-custom" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'start' }}><select className="styled-input" value={item.academicEventId} onChange={(event) => setExamScopesDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, academicEventId: event.target.value } : entry))} disabled={!canEdit}><option value="">연결 일정 선택</option>{schoolEvents.filter((event) => event.type === '시험' || event.type === '학원행사').map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select><input className="styled-input" placeholder="직접 시험명 입력" value={item.periodLabel} onChange={(event) => setExamScopesDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, periodLabel: event.target.value } : entry))} disabled={!canEdit} />{canEdit && <button type="button" className="btn-icon" style={{ color: '#ef4444', marginTop: 6 }} onClick={() => setExamScopesDraft((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={16} /></button>}</div><textarea className="styled-input" placeholder="교과서 범위" value={item.textbookScope} onChange={(event) => setExamScopesDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, textbookScope: event.target.value } : entry))} disabled={!canEdit} style={{ minHeight: 60, resize: 'vertical' }} /><textarea className="styled-input" placeholder="부교재 범위" value={item.supplementScope} onChange={(event) => setExamScopesDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, supplementScope: event.target.value } : entry))} disabled={!canEdit} style={{ minHeight: 60, resize: 'vertical' }} /><textarea className="styled-input" placeholder="기타 범위" value={item.otherScope} onChange={(event) => setExamScopesDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, otherScope: event.target.value } : entry))} disabled={!canEdit} style={{ minHeight: 60, resize: 'vertical' }} /><textarea className="styled-input" placeholder="비고" value={item.note} onChange={(event) => setExamScopesDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, note: event.target.value } : entry))} disabled={!canEdit} style={{ minHeight: 60, resize: 'vertical' }} /></div>)}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>영어·수학 시험당일</strong>{canEdit && <button type="button" className="btn-secondary" onClick={() => setExamDaysDraft((current) => [...current, { id: createId(), subject: current.length % 2 === 0 ? '영어' : '수학', examDate: '', label: '', note: '', sortOrder: current.length }])}><Plus size={16} /> 추가</button>}</div>
              {examDaysDraft.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>등록된 시험당일이 없습니다.</div>}
              {examDaysDraft.map((item) => <div key={item.id} className="card-custom" style={{ padding: 14, display: 'grid', gridTemplateColumns: '120px 160px 1fr auto', gap: 10, alignItems: 'start' }}><select className="styled-input" value={item.subject} onChange={(event) => setExamDaysDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, subject: event.target.value } : entry))} disabled={!canEdit}><option value="영어">영어</option><option value="수학">수학</option></select><input type="date" className="styled-input" value={item.examDate} onChange={(event) => setExamDaysDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, examDate: event.target.value } : entry))} disabled={!canEdit} /><div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><input className="styled-input" placeholder="예: 1학기 중간고사" value={item.label} onChange={(event) => setExamDaysDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} disabled={!canEdit} /><textarea className="styled-input" placeholder="비고" value={item.note} onChange={(event) => setExamDaysDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, note: event.target.value } : entry))} disabled={!canEdit} style={{ minHeight: 60, resize: 'vertical' }} /></div>{canEdit && <button type="button" className="btn-icon" style={{ color: '#ef4444', marginTop: 6 }} onClick={() => setExamDaysDraft((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={16} /></button>}</div>)}

              {canEdit && <button type="button" className="btn-primary" onClick={saveProfileBundle} disabled={isBusy}><Save size={16} /> 공유 정보 저장</button>}
            </div>}
          </Section>
        </div>
      </div>

      {editingEvent && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 20, backdropFilter: 'blur(10px)' }} onClick={closeModal}><div className="card animate-in" style={{ width: '100%', maxWidth: 560, padding: 0, overflow: 'hidden' }} onClick={(event) => event.stopPropagation()}><div style={{ padding: '20px 24px', background: 'var(--bg-surface-hover)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{editingEvent.id ? '학사일정 수정' : '새 학사일정'}</h3><button className="btn-icon" onClick={closeModal}><X size={20} /></button></div><div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}><input type="text" className="styled-date-input" placeholder="예: 1학기 중간고사" style={{ width: '100%', height: 44, fontSize: 15 }} value={editingEvent.title} onChange={(event) => setEditingEvent((prev) => ({ ...prev, title: event.target.value }))} disabled={!canEdit} /><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}><select className="styled-date-input" style={{ width: '100%', height: 44 }} value={editingEvent.schoolId || ''} onChange={(event) => { const school = schoolMap[event.target.value]; setEditingEvent((prev) => ({ ...prev, schoolId: event.target.value, school: school?.name || '', color: school?.color || DEFAULT_COLOR, grade: normalizeGrade(prev.grade, school?.category || 'high') })); }} disabled={!canEdit}><option value="">학교 선택</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select><select className="styled-date-input" style={{ width: '100%', height: 44 }} value={editingEvent.type} onChange={(event) => setEditingEvent((prev) => ({ ...prev, type: event.target.value }))} disabled={!canEdit}>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select><select className="styled-date-input" style={{ width: '100%', height: 44 }} value={editingEvent.grade || 'all'} onChange={(event) => setEditingEvent((prev) => ({ ...prev, grade: event.target.value }))} disabled={!canEdit}>{GRADE_OPTIONS.map((grade) => <option key={grade} value={grade}>{grade === 'all' ? '전체' : grade}</option>)}</select></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}><input type="date" className="styled-date-input" style={{ width: '100%', height: 44 }} value={editingEvent.start} onChange={(event) => setEditingEvent((prev) => ({ ...prev, start: event.target.value, end: prev.end < event.target.value ? event.target.value : prev.end }))} disabled={!canEdit} /><input type="date" className="styled-date-input" style={{ width: '100%', height: 44 }} value={editingEvent.end} onChange={(event) => setEditingEvent((prev) => ({ ...prev, end: event.target.value }))} disabled={!canEdit} /></div><textarea className="styled-input" style={{ width: '100%', minHeight: 96, resize: 'vertical' }} value={editingEvent.note || ''} onChange={(event) => setEditingEvent((prev) => ({ ...prev, note: event.target.value }))} placeholder="시험 범위, 학교 메모, 주의사항을 기록해 두세요" disabled={!canEdit} /></div><div style={{ padding: '16px 24px', background: 'var(--bg-surface-hover)', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: editingEvent.id ? 'space-between' : 'flex-end', gap: 12 }}>{editingEvent.id && canEdit && <button className="btn btn-secondary" onClick={deleteEvent} style={{ color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)' }}><Trash2 size={18} /> 삭제</button>}<div style={{ display: 'flex', gap: 12 }}><button className="btn btn-secondary" onClick={closeModal}>닫기</button>{canEdit && <button className="btn btn-primary" onClick={saveEvent} style={{ gap: 8 }}><Save size={18} /> 저장</button>}</div></div></div></div>}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
