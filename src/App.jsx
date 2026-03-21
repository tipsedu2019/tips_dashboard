import { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart2,
  BookOpen,
  Building2,
  Calendar,
  LayoutGrid,
  ClipboardList,
  CalendarDays,
  Eye,
  LogOut,
  Menu,
  Moon,
  Settings2,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { dataService } from './services/dataService';
import { useAuth } from './contexts/AuthContext';
import { isE2EModeEnabled } from './testing/e2e/e2eMode';
import { e2eDataService } from './testing/e2e/mockDataService';
import LoginModal from './components/SettingsModal';
import BottomSheet from './components/ui/BottomSheet';
import PageLoader from './components/ui/PageLoader';
import StatusBanner from './components/ui/StatusBanner';
import TermManagerModal from './components/ui/TermManagerModal';
import TimetableUnifiedFilterPanel from './components/ui/TimetableUnifiedFilterPanel';
import useViewport from './hooks/useViewport';
import { collectGradeOptions } from './components/timetableViewUtils';
import {
  ACTIVE_CLASS_STATUS,
  computeClassStatus,
} from './lib/classStatus';
import { buildClassroomMaster, buildTeacherMaster } from './lib/resourceCatalogs';
import { sortSubjectOptions } from './lib/subjectUtils';
import {
  getClassroomDisplayName,
  parseSchedule,
  splitClassroomList,
  splitTeacherList,
} from './data/sampleData';

const ClassroomWeeklyView = lazy(() => import('./components/ClassroomWeeklyView'));
const TeacherWeeklyView = lazy(() => import('./components/TeacherWeeklyView'));
const DailyClassroomView = lazy(() => import('./components/DailyClassroomView'));
const DailyTeacherView = lazy(() => import('./components/DailyTeacherView'));
const DataManager = lazy(() => import('./components/DataManager'));
const StudentWeeklyView = lazy(() => import('./components/StudentWeeklyView'));
const AcademicCalendarView = lazy(() => import('./components/AcademicCalendarView'));
const CurriculumRoadmapView = lazy(() => import('./components/CurriculumRoadmapView'));
const PublicClassListView = lazy(() => import('./components/PublicClassLandingView'));
const ClassListWorkspace = lazy(() => import('./components/ClassListWorkspace'));
const StatsDashboard = lazy(() => import('./components/StatsDashboard'));

const ALL_OPTION = '전체';
const LOCAL_TERM_STORAGE_KEY = 'tips-dashboard:local-terms';
const CURRENT_TERM_STORAGE_KEY = 'tips-dashboard:current-term';
const CURRENT_TERM_PREFERENCE_KEY = 'tips-dashboard:current-term';
const TIMETABLE_FILTER_STORAGE_KEY = 'tips-dashboard:timetable-filters-v2';
const DEFAULT_TIMETABLE_FILTERS = {
  term: '',
  subject: [],
  grade: [],
  teacher: [],
  classroom: [],
};
const TIMETABLE_VIEW_IDS = ['class-list', 'teacher-weekly', 'classroom-weekly', 'daily-teacher', 'daily-classroom', 'student-weekly'];
const TIMETABLE_TABS = [
  {
    id: 'class-list',
    label: '수업 목록',
    icon: ClipboardList,
    description: '전체 수업을 먼저 검색하고 정렬한 뒤, 필요한 시간표 화면으로 바로 넘어갈 수 있습니다.',
  },
  {
    id: 'teacher-weekly',
    label: '선생님 주간',
    icon: Users,
    description: '선생님별 주간 시간표를 한 작업 공간에서 비교하며 확인할 수 있습니다.',
  },
  {
    id: 'classroom-weekly',
    label: '강의실 주간',
    icon: Building2,
    description: '강의실 점유 상태를 주간 기준으로 보고, 중복 사용 여부를 빠르게 점검할 수 있습니다.',
  },
  {
    id: 'daily-teacher',
    label: '일별 선생님',
    icon: Users,
    description: '하루 단위로 선생님 스케줄을 집중해서 확인하고 조정할 수 있습니다.',
  },
  {
    id: 'daily-classroom',
    label: '일별 강의실',
    icon: Building2,
    description: '하루 기준 강의실 배치를 점검하고 비어 있는 시간대를 빠르게 찾을 수 있습니다.',
  },
  {
    id: 'student-weekly',
    label: '학생 시간표',
    icon: User,
    description: '학생별 주간 시간표를 확인하며 수업 충돌이나 이동 동선을 점검할 수 있습니다.',
  },
];

const NAV_VIEWS = [
  { id: 'stats', label: '개요', icon: BarChart2, staffOnly: false },
  { id: 'timetable', label: '시간표', icon: LayoutGrid, staffOnly: false },
  { id: 'academic-calendar', label: '학사 일정', icon: CalendarDays, staffOnly: false },
  { id: 'curriculum-roadmap', label: '교재·진도', icon: BookOpen, staffOnly: true },
  { id: 'data-manager', label: '데이터 관리', icon: ClipboardList, staffOnly: true },
];

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPublicModeFromLocation() {
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'public';
}

function replacePublicMode(next) {
  if (typeof window === 'undefined') {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (next) {
    params.set('view', 'public');
  } else {
    params.delete('view');
  }

  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, '', nextUrl);
}

function mergeTermsByName(...collections) {
  const merged = new Map();

  collections.flat().filter(Boolean).forEach((term, index) => {
    const name = String(term?.name || term?.period || '').trim();
    if (!name) {
      return;
    }

    const previous = merged.get(name) || {};
    merged.set(name, {
      ...previous,
      ...term,
      name,
      sortOrder: Number(term?.sortOrder ?? term?.sort_order ?? previous.sortOrder ?? index),
    });
  });

  return [...merged.values()];
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTimetableFilters(raw = null) {
  return {
    term: typeof raw?.term === 'string' ? raw.term : '',
    subject: Array.isArray(raw?.subject) ? raw.subject.filter(Boolean) : [],
    grade: Array.isArray(raw?.grade) ? raw.grade.filter(Boolean) : [],
    teacher: Array.isArray(raw?.teacher) ? raw.teacher.filter(Boolean) : [],
    classroom: Array.isArray(raw?.classroom) ? raw.classroom.filter(Boolean) : [],
  };
}

function normalizeCurrentTermPreference(raw = null) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const name = String(raw?.name || '').trim();
  const academicYear = raw?.academicYear ? Number(raw.academicYear) : null;
  const termId = raw?.termId ? String(raw.termId) : '';

  if (!name && !termId) {
    return null;
  }

  return {
    termId,
    academicYear: Number.isFinite(academicYear) ? academicYear : null,
    name,
  };
}

function resolveClassTermName(classItem, managedTerms = []) {
  const directPeriod = String(classItem?.period || '').trim();
  if (directPeriod) {
    return directPeriod;
  }

  const matchedTerm = (managedTerms || []).find((term) => String(term.id || '') === String(classItem?.termId || ''));
  return String(matchedTerm?.name || '').trim();
}

function collectClassTeachers(classItem) {
  const teachers = new Set(splitTeacherList(classItem?.teacher));

  parseSchedule(classItem?.schedule, classItem).forEach((slot) => {
    splitTeacherList(slot?.teacher).forEach((teacher) => {
      if (teacher) {
        teachers.add(teacher);
      }
    });
  });

  return [...teachers].filter(Boolean);
}

function collectClassClassrooms(classItem) {
  const classrooms = new Set(
    splitClassroomList(classItem?.classroom || classItem?.room)
      .map((value) => getClassroomDisplayName(value))
      .filter(Boolean)
  );

  parseSchedule(classItem?.schedule, classItem).forEach((slot) => {
    const classroom = getClassroomDisplayName(slot?.classroom || '');
    if (classroom) {
      classrooms.add(classroom);
    }
  });

  return [...classrooms];
}

function filterResourceNamesBySubjects(entries = [], selectedSubjects = []) {
  const normalizedSubjects = Array.isArray(selectedSubjects)
    ? selectedSubjects.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (normalizedSubjects.length === 0) {
    return (entries || [])
      .filter((entry) => entry?.isVisible !== false)
      .map((entry) => entry.name);
  }

  const subjectSet = new Set(normalizedSubjects);

  return (entries || [])
    .filter((entry) => {
      if (entry?.isVisible === false) {
        return false;
      }

      const subjects = Array.isArray(entry?.subjects)
        ? entry.subjects.map((value) => String(value || '').trim()).filter(Boolean)
        : [];

      return subjects.some((subject) => subjectSet.has(subject));
    })
    .map((entry) => entry.name);
}

function buildStatusBanner(authError, data) {
  if (authError) {
    return {
      variant: 'warning',
      title: '제한된 접근 모드',
      message: authError,
    };
  }

  if (data.error && !data.isConnected) {
    return {
      variant: 'error',
      title: '데이터 연결 불가',
      message: data.error,
    };
  }

  if (data.error) {
    return {
      variant: 'warning',
      title: '일부 데이터 로드 경고',
      message: data.error,
    };
  }

  return null;
}

export default function App() {
  const { isMobile, isTablet, isCompact } = useViewport();
  const activeDataService = isE2EModeEnabled() ? e2eDataService : dataService;
  const [currentView, setCurrentView] = useState('stats');
  const [data, setData] = useState({
    classes: [],
    students: [],
    textbooks: [],
    progressLogs: [],
    classTerms: [],
    academicEvents: [],
    academicSchools: [],
    teacherCatalogs: [],
    classroomCatalogs: [],
    academicCurriculumProfiles: [],
    academicSupplementMaterials: [],
    academicEventExamDetails: [],
    academicExamMaterialPlans: [],
    academicExamMaterialItems: [],
    academicExamDays: [],
    academicExamScopes: [],
    academyCurriculumPlans: [],
    academyCurriculumMaterials: [],
    academyCurriculumPeriodCatalogs: [],
    academyCurriculumPeriodPlans: [],
    academyCurriculumPeriodItems: [],
    isConnected: false,
    isLoading: true,
    lastUpdated: null,
    error: null,
  });
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [timetableFilters, setTimetableFilters] = useState(() => normalizeTimetableFilters(readStoredJson(TIMETABLE_FILTER_STORAGE_KEY, DEFAULT_TIMETABLE_FILTERS)));
  const [currentTermPreference, setCurrentTermPreference] = useState(() => normalizeCurrentTermPreference(readStoredJson(CURRENT_TERM_STORAGE_KEY, null)));
  const [filterMode, setFilterMode] = useState('period');
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [selectedPeriod, setSelectedPeriod] = useState(ALL_OPTION);
  const [selectedSubject, setSelectedSubject] = useState(ALL_OPTION);
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const [isTermManagerOpen, setIsTermManagerOpen] = useState(false);
  const [isTimetableFilterSheetOpen, setIsTimetableFilterSheetOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [isPublicMode, setIsPublicMode] = useState(() => getPublicModeFromLocation());
  const [localTerms, setLocalTerms] = useState(() => readStoredJson(LOCAL_TERM_STORAGE_KEY, []));
  const [sidebarTooltip, setSidebarTooltip] = useState(null);
  const [isSubjectFlyoutOpen, setIsSubjectFlyoutOpen] = useState(false);
  const [subjectFlyoutAnchor, setSubjectFlyoutAnchor] = useState(null);
  const [isPeriodFlyoutOpen, setIsPeriodFlyoutOpen] = useState(false);
  const [periodFlyoutAnchor, setPeriodFlyoutAnchor] = useState(null);
  const [curriculumRoadmapIntent, setCurriculumRoadmapIntent] = useState(null);
  const [academicCalendarIntent, setAcademicCalendarIntent] = useState(null);
  const [dataManagerIntent, setDataManagerIntent] = useState(null);
  const subjectFlyoutCloseTimerRef = useRef(null);
  const periodFlyoutCloseTimerRef = useRef(null);

  const { user, isStaff, isTeacher, logout, loading, authError } = useAuth();
  const showMinimalSidebar = !isCompact;
  const canAccessCurriculumRoadmap = isStaff || isTeacher;

  const changeView = (nextView, { closeSidebar = true } = {}) => {
    startTransition(() => {
      setCurrentView(nextView);
    });
    if (closeSidebar) {
      setSidebarOpen(false);
    }
  };

  const goHome = () => {
    changeView('stats');
  };

  const openCurriculumRoadmap = (intent = null) => {
    setCurriculumRoadmapIntent(intent ? { ...intent, nonce: Date.now() } : { nonce: Date.now() });
    changeView('curriculum-roadmap', { closeSidebar: false });
  };

  const openAcademicCalendar = (intent = null) => {
    setAcademicCalendarIntent(intent ? { ...intent, nonce: Date.now() } : { nonce: Date.now() });
    changeView('academic-calendar', { closeSidebar: false });
  };

  const openDataManager = (intent = null) => {
    setDataManagerIntent(intent ? { ...intent, nonce: Date.now() } : { nonce: Date.now() });
    changeView('data-manager', { closeSidebar: false });
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_TERM_STORAGE_KEY, JSON.stringify(localTerms || []));
    } catch {
      // ignore local storage persistence failures
    }
  }, [localTerms]);

  useEffect(() => {
    try {
      localStorage.setItem(TIMETABLE_FILTER_STORAGE_KEY, JSON.stringify(timetableFilters));
    } catch {
      // ignore local storage persistence failures
    }
  }, [timetableFilters]);

  useEffect(() => {
    try {
      if (currentTermPreference) {
        localStorage.setItem(CURRENT_TERM_STORAGE_KEY, JSON.stringify(currentTermPreference));
      } else {
        localStorage.removeItem(CURRENT_TERM_STORAGE_KEY);
      }
    } catch {
      // ignore local storage persistence failures
    }
  }, [currentTermPreference]);

  useEffect(() => {
    let cancelled = false;

    activeDataService.getAppPreference?.(CURRENT_TERM_PREFERENCE_KEY)
      .then((savedPreference) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeCurrentTermPreference(savedPreference?.value || savedPreference || null);
        if (normalized) {
          setCurrentTermPreference(normalized);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Current term preference load skipped:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDataService]);

  useEffect(() => {
    const unsubscribe = activeDataService.subscribe(setData);
    return unsubscribe;
  }, [activeDataService]);

  useEffect(() => {
    if (!isCompact || !TIMETABLE_VIEW_IDS.includes(currentView)) {
      setIsTimetableFilterSheetOpen(false);
    }
  }, [currentView, isCompact]);

  useEffect(() => {
    const handlePopState = () => {
      setIsPublicMode(getPublicModeFromLocation());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!isStaff || data.isLoading || !Array.isArray(data.classes) || data.classes.length === 0) {
      return;
    }

    const storageKey = 'tips-dashboard:classroom-normalize-v1';
    if (localStorage.getItem(storageKey)) {
      return;
    }

    const hasLegacyRoom = data.classes.some((classItem) => {
      const room = classItem.roomRaw || classItem.room || '';
      return room && room !== classItem.classroom;
    });

    if (!hasLegacyRoom) {
      localStorage.setItem(storageKey, 'clean');
      return;
    }

    let cancelled = false;
    activeDataService.normalizeLegacyClassrooms(data.classes)
      .then((updatedCount) => {
        if (cancelled || updatedCount === 0) {
          return;
        }
        localStorage.setItem(storageKey, String(updatedCount));
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Legacy classroom normalization skipped:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDataService, data.classes, data.isLoading, isStaff]);

  useEffect(() => {
    if (currentView === 'planner') {
      changeView('class-list', { closeSidebar: false });
    }
    if (currentView === 'curriculum-dashboard') {
      changeView('curriculum-roadmap', { closeSidebar: false });
    }
  }, [currentView]);

  useEffect(() => {
    if (!showMinimalSidebar) {
      setSidebarTooltip(null);
    }
  }, [showMinimalSidebar]);

  useEffect(() => {
    if (user && ((currentView === 'data-manager' && !isStaff) || (currentView === 'curriculum-roadmap' && !canAccessCurriculumRoadmap))) {
      changeView('stats', { closeSidebar: false });
    }
  }, [canAccessCurriculumRoadmap, currentView, isStaff, user]);

  const selectedStudent = useMemo(() => (
    data.students?.find((student) => student.id === selectedStudentId) || null
  ), [data.students, selectedStudentId]);

  const persistCurrentTermPreference = useCallback(async (nextPreference) => {
    const normalized = normalizeCurrentTermPreference(nextPreference);
    setCurrentTermPreference(normalized);

    if (!activeDataService.setAppPreference) {
      return;
    }

    try {
      await activeDataService.setAppPreference(CURRENT_TERM_PREFERENCE_KEY, normalized);
    } catch (error) {
      console.warn('Current term preference save skipped:', error);
    }
  }, [activeDataService]);

  const handleTimetableFilterChange = useCallback((key, value) => {
    setTimetableFilters((current) => normalizeTimetableFilters({
      ...current,
      [key]: Array.isArray(value) ? [...value] : value,
    }));
  }, []);

  const periodMeta = useMemo(() => {
    const result = {};

    (data.classTerms || []).forEach((term) => {
      const name = term.name || term.period || '';
      if (!name) return;
      result[name] = {
        startDate: term.startDate || term.start_date || '',
        endDate: term.endDate || term.end_date || '',
        status: term.status || '',
        academicYear: term.academicYear || term.academic_year || '',
      };
    });

    (localTerms || []).forEach((term) => {
      const name = term.name || term.period || '';
      if (!name || result[name]) return;
      result[name] = {
        startDate: term.startDate || term.start_date || '',
        endDate: term.endDate || term.end_date || '',
        status: term.status || '',
        academicYear: term.academicYear || term.academic_year || '',
      };
    });

    (data.classes || []).forEach((classItem) => {
      if (!classItem.period || result[classItem.period]) return;
      result[classItem.period] = {
        startDate: classItem.startDate,
        endDate: classItem.endDate,
        status: computeClassStatus(classItem),
        academicYear: '',
      };
    });

    return result;
  }, [data.classTerms, data.classes, localTerms]);

  const termNames = useMemo(() => {
    const values = new Set();

    (data.classTerms || []).forEach((term) => {
      const name = term.name || term.period || '';
      if (name) {
        values.add(name);
      }
    });

    (localTerms || []).forEach((term) => {
      const name = term.name || term.period || '';
      if (name) {
        values.add(name);
      }
    });

    (data.classes || []).forEach((classItem) => {
      if (classItem.period) {
        values.add(classItem.period);
      }
    });

    return Array.from(values).sort((left, right) => left.localeCompare(right, 'ko'));
  }, [data.classTerms, data.classes, localTerms]);

  const managedTerms = useMemo(() => {
    const result = [];
    const knownNames = new Set();

    mergeTermsByName(localTerms || [], data.classTerms || []).forEach((term, index) => {
      const name = term.name || term.period || '';
      if (!name) return;
      knownNames.add(name);
      result.push({
        ...term,
        id: term.id,
        academicYear: Number(term.academicYear || term.academic_year || new Date().getFullYear()),
        name,
        status: term.status || periodMeta[name]?.status || '수업 진행 중',
        startDate: term.startDate || term.start_date || periodMeta[name]?.startDate || '',
        endDate: term.endDate || term.end_date || periodMeta[name]?.endDate || '',
        sortOrder: Number(term.sortOrder ?? term.sort_order ?? index),
      });
    });

    termNames.forEach((period, index) => {
        if (knownNames.has(period)) return;
        result.push({
          id: `legacy-${period}`,
          academicYear: Number(periodMeta[period]?.academicYear || new Date().getFullYear()),
          name: period,
          status: periodMeta[period]?.status || '수업 진행 중',
          startDate: periodMeta[period]?.startDate || '',
          endDate: periodMeta[period]?.endDate || '',
          sortOrder: result.length + index,
          legacyOnly: true,
        });
      });

    return result.sort((left, right) => {
      const yearGap = Number(right.academicYear || 0) - Number(left.academicYear || 0);
      if (yearGap !== 0) {
        return yearGap;
      }
      return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    });
  }, [data.classTerms, localTerms, periodMeta, termNames]);

  const periods = useMemo(() => [ALL_OPTION, ...termNames], [termNames]);

  const currentTerm = useMemo(() => {
    if (!currentTermPreference) {
      return null;
    }

    return managedTerms.find((term) => {
      const sameId = currentTermPreference.termId && String(term.id || '') === String(currentTermPreference.termId);
      const sameYearAndName =
        currentTermPreference.academicYear &&
        Number(term.academicYear || 0) === Number(currentTermPreference.academicYear) &&
        term.name === currentTermPreference.name;
      const sameName = currentTermPreference.name && term.name === currentTermPreference.name;
      return sameId || sameYearAndName || sameName;
    }) || null;
  }, [currentTermPreference, managedTerms]);

  const currentTermName = currentTerm?.name || '';

  useEffect(() => {
    const availableTerms = new Set(managedTerms.map((term) => term.name));
    setTimetableFilters((current) => {
      const next = normalizeTimetableFilters(current);
      let changed = false;

      if (next.term && !availableTerms.has(next.term)) {
        next.term = '';
        changed = true;
      }

      if (!next.term && currentTermName) {
        next.term = currentTermName;
        changed = true;
      }

      return changed ? next : current;
    });
  }, [currentTermName, managedTerms]);

  const termFilteredClasses = useMemo(() => {
    if (!timetableFilters.term) {
      return data.classes;
    }
    return (data.classes || []).filter((classItem) => resolveClassTermName(classItem, managedTerms) === timetableFilters.term);
  }, [data.classes, managedTerms, timetableFilters.term]);

  const subjectOptions = useMemo(
    () => sortSubjectOptions(termFilteredClasses.map((classItem) => classItem.subject).filter(Boolean), { includeDefaults: false }),
    [termFilteredClasses]
  );
  const subjects = useMemo(() => [ALL_OPTION, ...subjectOptions], [subjectOptions]);

  const subjectFilteredClasses = useMemo(() => {
    if (!timetableFilters.subject.length) {
      return termFilteredClasses;
    }
    const selectedSubjects = new Set(timetableFilters.subject);
    return termFilteredClasses.filter((classItem) => selectedSubjects.has(classItem.subject));
  }, [termFilteredClasses, timetableFilters.subject]);

  const gradeOptions = useMemo(() => collectGradeOptions(subjectFilteredClasses), [subjectFilteredClasses]);

  const gradeFilteredClasses = useMemo(() => {
    if (!timetableFilters.grade.length) {
      return subjectFilteredClasses;
    }
    const selectedGrades = new Set(timetableFilters.grade);
    return subjectFilteredClasses.filter((classItem) => selectedGrades.has(String(classItem.grade || '').trim()));
  }, [subjectFilteredClasses, timetableFilters.grade]);

  const timetableTeacherMaster = useMemo(
    () => buildTeacherMaster(data.teacherCatalogs, gradeFilteredClasses),
    [data.teacherCatalogs, gradeFilteredClasses]
  );

  const teacherOptions = useMemo(
    () => filterResourceNamesBySubjects(timetableTeacherMaster, timetableFilters.subject),
    [timetableTeacherMaster, timetableFilters.subject]
  );

  const timetableClassroomMaster = useMemo(
    () => buildClassroomMaster(data.classroomCatalogs, gradeFilteredClasses),
    [data.classroomCatalogs, gradeFilteredClasses]
  );

  const classroomOptions = useMemo(
    () => filterResourceNamesBySubjects(timetableClassroomMaster, timetableFilters.subject),
    [timetableClassroomMaster, timetableFilters.subject]
  );

  useEffect(() => {
    setTimetableFilters((current) => {
      const next = normalizeTimetableFilters(current);
      const sanitized = {
        ...next,
        subject: next.subject.filter((value) => subjectOptions.includes(value)),
        grade: next.grade.filter((value) => gradeOptions.includes(value)),
        teacher: next.teacher.filter((value) => teacherOptions.includes(value)),
        classroom: next.classroom.filter((value) => classroomOptions.includes(value)),
      };

      const changed =
        sanitized.subject.length !== next.subject.length ||
        sanitized.grade.length !== next.grade.length ||
        sanitized.teacher.length !== next.teacher.length ||
        sanitized.classroom.length !== next.classroom.length;

      return changed ? sanitized : current;
    });
  }, [classroomOptions, gradeOptions, subjectOptions, teacherOptions]);

  const filteredClasses = useMemo(() => {
    let nextClasses = gradeFilteredClasses;

    if (timetableFilters.teacher.length > 0) {
      const selectedTeachers = new Set(timetableFilters.teacher);
      nextClasses = nextClasses.filter((classItem) => collectClassTeachers(classItem).some((teacher) => selectedTeachers.has(teacher)));
    }

    if (timetableFilters.classroom.length > 0) {
      const selectedClassrooms = new Set(timetableFilters.classroom);
      nextClasses = nextClasses.filter((classItem) => collectClassClassrooms(classItem).some((classroom) => selectedClassrooms.has(classroom)));
    }

    return nextClasses;
  }, [gradeFilteredClasses, timetableFilters.classroom, timetableFilters.teacher]);

  const weeklyAxisClasses = useMemo(() => filteredClasses, [filteredClasses]);

  const statusBanner = useMemo(() => buildStatusBanner(authError, data), [authError, data]);
  const visibleViews = useMemo(() => (
    NAV_VIEWS.filter((view) => {
      if (!view.staffOnly) return true;
      if (view.id === 'curriculum-roadmap') {
        return canAccessCurriculumRoadmap;
      }
      return isStaff;
    })
  ), [canAccessCurriculumRoadmap, isStaff]);
  const currentViewMeta = useMemo(
    () => visibleViews.find((view) => view.id === (TIMETABLE_VIEW_IDS.includes(currentView) ? 'timetable' : currentView)) || NAV_VIEWS[0],
    [currentView, visibleViews]
  );
  const currentTimetableTab = useMemo(
    () => TIMETABLE_TABS.find((tab) => tab.id === currentView) || TIMETABLE_TABS[0],
    [currentView]
  );
  const currentViewLabel = TIMETABLE_VIEW_IDS.includes(currentView) ? currentTimetableTab.label : currentViewMeta.label;
  const timetableSummaryTokens = useMemo(() => {
    const tokens = [];
    if (timetableFilters.term || currentTermName) {
      tokens.push(`학기 · ${timetableFilters.term || currentTermName}`);
    }
    if (timetableFilters.subject.length > 0) {
      tokens.push(...timetableFilters.subject.slice(0, 2).map((value) => `과목 · ${value}`));
    }
    if (timetableFilters.grade.length > 0) {
      tokens.push(...timetableFilters.grade.slice(0, 2).map((value) => `학년 · ${value}`));
    }
    if (timetableFilters.teacher.length > 0) {
      tokens.push(...timetableFilters.teacher.slice(0, 1).map((value) => `선생님 · ${value}`));
    }
    if (timetableFilters.classroom.length > 0) {
      tokens.push(...timetableFilters.classroom.slice(0, 1).map((value) => `강의실 · ${value}`));
    }
    tokens.push(`${filteredClasses.length}개 수업`);
    return tokens;
  }, [currentTermName, filteredClasses.length, timetableFilters.classroom, timetableFilters.grade, timetableFilters.subject, timetableFilters.teacher, timetableFilters.term]);
  const isAcademicHubView = currentView === 'academic-calendar' || currentView === 'curriculum-roadmap';
  const activeMobileTab = useMemo(() => {
    if (TIMETABLE_VIEW_IDS.includes(currentView)) {
      return 'timetable';
    }

    if (currentView === 'academic-calendar') {
      return 'academic-calendar';
    }

    if (currentView === 'curriculum-roadmap') {
      return 'academic-calendar';
    }

    if (currentView === 'data-manager') {
      return 'data-manager';
    }

    return 'stats';
  }, [currentView]);

  const displayUserName = user?.name || user?.email || '사용자';
  const isDataBootstrapping = data.isLoading && !data.lastUpdated;
  const isUnifiedTimetableView = TIMETABLE_VIEW_IDS.includes(currentView) && currentView !== 'student-weekly';
  const timetableDefaultStatus =
    timetableFilters.term
      ? (periodMeta[timetableFilters.term]?.status || ACTIVE_CLASS_STATUS)
      : ACTIVE_CLASS_STATUS;
  const timetableDefaultPeriod = timetableFilters.term || currentTermName || '';

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  const clearSubjectFlyoutCloseTimer = () => {
    if (subjectFlyoutCloseTimerRef.current) {
      window.clearTimeout(subjectFlyoutCloseTimerRef.current);
      subjectFlyoutCloseTimerRef.current = null;
    }
  };
  const clearPeriodFlyoutCloseTimer = () => {
    if (periodFlyoutCloseTimerRef.current) {
      window.clearTimeout(periodFlyoutCloseTimerRef.current);
      periodFlyoutCloseTimerRef.current = null;
    }
  };
  const openSidebarTooltip = (event, label) => {
    if (!showMinimalSidebar || !label) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSidebarTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
  };
  const closeSidebarTooltip = () => {
    setSidebarTooltip(null);
  };
  const openSubjectFlyout = (event) => {
    if (!showMinimalSidebar) {
      return;
    }
    clearSubjectFlyoutCloseTimer();
    clearPeriodFlyoutCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    setSubjectFlyoutAnchor({
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
    setIsSubjectFlyoutOpen(true);
    setIsPeriodFlyoutOpen(false);
    setSidebarTooltip(null);
  };
  const scheduleCloseSubjectFlyout = () => {
    clearSubjectFlyoutCloseTimer();
    subjectFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setIsSubjectFlyoutOpen(false);
    }, 100);
  };
  const openPeriodFlyout = (event) => {
    if (!showMinimalSidebar) {
      return;
    }
    clearPeriodFlyoutCloseTimer();
    clearSubjectFlyoutCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    setPeriodFlyoutAnchor({
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
    setIsPeriodFlyoutOpen(true);
    setIsSubjectFlyoutOpen(false);
    setSidebarTooltip(null);
  };
  const scheduleClosePeriodFlyout = () => {
    clearPeriodFlyoutCloseTimer();
    periodFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setIsPeriodFlyoutOpen(false);
    }, 100);
  };
  const selectPeriodFromFlyout = (period) => {
    setSelectedPeriod(period);
    localStorage.setItem('selectedPeriod', period);
    setFilterMode('period');
    localStorage.setItem('filterMode', 'period');
    setIsPeriodFlyoutOpen(false);
  };
  const navigateMobileTab = (tabId) => {
    if (tabId === 'timetable') {
      startTransition(() => {
        setCurrentView((current) => (TIMETABLE_VIEW_IDS.includes(current) ? current : 'class-list'));
      });
      return;
    }

    if (tabId === 'curriculum-roadmap') {
      openCurriculumRoadmap();
      return;
    }

    if (tabId === 'data-manager') {
      openDataManager();
      return;
    }

    changeView(tabId, { closeSidebar: false });
  };

  const setFilterModeAndPersist = (mode) => {
    setFilterMode(mode);
    localStorage.setItem('filterMode', mode);
  };

  const setPublicModeAndSync = (next) => {
    setIsPublicMode(next);
    replacePublicMode(next);
    if (!next) {
      changeView('stats', { closeSidebar: false });
    }
  };

  const openStudentSchedule = (studentId) => {
    setSelectedStudentId(studentId);
    changeView('student-weekly', { closeSidebar: false });
  };

  const renderTimetableTabs = ({ compact = false } = {}) => (
    <div className={`workspace-tabs timetable-workspace-tabs ${compact ? 'workspace-tabs-compact' : ''}`}>
      {TIMETABLE_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className={`h-segment-btn workspace-tab-btn ${currentView === tab.id ? 'active' : ''}`}
            aria-pressed={currentView === tab.id}
            aria-label={tab.label}
            title={tab.description}
            onClick={() => changeView(tab.id, { closeSidebar: false })}
          >
            <Icon size={16} className="workspace-tab-icon" aria-hidden="true" focusable="false" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderUnifiedTimetableFilterPanel = ({ compact = false } = {}) => (
    <TimetableUnifiedFilterPanel
      compact={compact}
      filters={timetableFilters}
      termOptions={managedTerms}
      subjectOptions={subjectOptions}
      gradeOptions={gradeOptions}
      teacherOptions={teacherOptions}
      classroomOptions={classroomOptions}
      currentTermLabel={currentTermName}
      onChange={handleTimetableFilterChange}
    />
  );

  const renderPeriodDropdown = () => (
    <div className="period-dropdown-shell">
      <button
        type="button"
        className="custom-dropdown-btn"
        aria-haspopup="listbox"
        aria-expanded={isPeriodDropdownOpen}
        aria-controls="period-dropdown-menu"
        onClick={() => setIsPeriodDropdownOpen((current) => !current)}
      >
        <span className="period-dropdown-current">{selectedPeriod}</span>
        <ChevronDown
          size={16}
          className={`period-dropdown-caret ${isPeriodDropdownOpen ? 'is-open' : ''}`}
          aria-hidden="true"
          focusable="false"
        />
      </button>
      {isPeriodDropdownOpen && (
        <>
          <button
            type="button"
            className="shell-overlay"
            aria-label="학기 선택 닫기"
            onClick={() => setIsPeriodDropdownOpen(false)}
          />
          <div id="period-dropdown-menu" className="custom-dropdown-menu animate-in period-dropdown-menu">
            <div className="dropdown-scroll-area">
              {periods.map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`custom-dropdown-item ${selectedPeriod === period ? 'active' : ''}`}
                  aria-pressed={selectedPeriod === period}
                  aria-label={`학기 ${period}`}
                  onClick={() => {
                    setSelectedPeriod(period);
                    localStorage.setItem('selectedPeriod', period);
                    setIsPeriodDropdownOpen(false);
                  }}
                >
                  <div className="period-dropdown-item-head">
                    <span>{period}</span>
                    {period !== ALL_OPTION && periodMeta[period]?.status ? (
                      <span className="period-dropdown-status">
                        {periodMeta[period].status}
                      </span>
                    ) : null}
                  </div>
                  {period !== ALL_OPTION && periodMeta[period] && (
                    <div className="period-dropdown-detail">
                      {[periodMeta[period].academicYear, periodMeta[period].startDate || '-', periodMeta[period].endDate || '-']
                        .filter(Boolean)
                        .join(' · ')
                        .replace(/ · ([0-9]{4}-[0-9]{2}-[0-9]{2}) · ([0-9]{4}-[0-9]{2}-[0-9]{2})$/, ' · $1 ~ $2')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderTimetableFilterPanel = ({ compact = false } = {}) => (
    <div className={compact ? 'timetable-filter-floating-card' : 'timetable-filter-card'}>
      <div className="timetable-filter-group">
        <label className="timetable-filter-label">학기</label>
        <div className="h-segment-container">
          {[
            { id: 'all', label: '전체' },
            { id: 'period', label: '학기' },
            { id: 'date', label: '날짜' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={filterMode === tab.id}
              onClick={() => setFilterModeAndPersist(tab.id)}
              className={`h-segment-btn ${filterMode === tab.id ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filterMode === 'date' && (
          <input
            type="date"
            value={selectedDate}
            className="styled-date-input"
            onChange={(event) => {
              setSelectedDate(event.target.value);
              localStorage.setItem('selectedDate', event.target.value);
            }}
          />
        )}

        {filterMode === 'period' && renderPeriodDropdown()}

        <button
          type="button"
          className={`action-chip ${compact ? '' : 'action-chip-full'}`.trim()}
          onClick={() => setIsTermManagerOpen(true)}
        >
          <Settings2 size={14} />
          학기 관리
        </button>

        <div className="timetable-filter-note">
          현재 {filteredClasses.length}개 수업이 선택되었습니다.
        </div>
      </div>

      <div className="timetable-filter-group">
        <label className="timetable-filter-label">과목</label>
        <div className="h-segment-container">
          {subjects.map((subject) => (
            <button
              key={subject}
              type="button"
              aria-pressed={selectedSubject === subject}
              onClick={() => {
                setSelectedSubject(subject);
                localStorage.setItem('selectedSubject', subject);
              }}
              className={`h-segment-btn ${selectedSubject === subject ? 'active' : ''}`}
            >
              {subject}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderTimetableMobileSummary = () => (
    <div className="card-custom timetable-mobile-summary" data-testid="timetable-mobile-summary">
      <div className="timetable-mobile-summary-head">
        <div>
          <div className="timetable-mobile-summary-eyebrow">{currentTimetableTab.label}</div>
          <strong className="timetable-mobile-summary-title">시간표 필터를 간단하게 유지합니다.</strong>
        </div>
        <button
          type="button"
          className="action-chip timetable-mobile-summary-button"
          data-testid="timetable-filter-button"
          onClick={() => setIsTimetableFilterSheetOpen(true)}
        >
          <Settings2 size={14} />
          필터
        </button>
      </div>
      <div className="timetable-mobile-summary-chips">
        {timetableSummaryTokens.map((token) => (
          <span key={token} className="timetable-mobile-summary-chip">{token}</span>
        ))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <PageLoader
        title="TIPS 대시보드를 준비하고 있습니다"
        message="계정 상태를 확인하고 최신 시간표와 데이터를 불러오는 중입니다."
      />
    );
  }

  const publicView = (
    <div className="public-app-shell" data-design-system="toss-refresh">
      {statusBanner && (
        <div className="public-mode-status-banner">
          <StatusBanner
            compact
            eyebrow="퍼블릭 모드"
            title={statusBanner.title}
            message={statusBanner.message}
            variant={statusBanner.variant}
          />
        </div>
      )}
      <Suspense
        fallback={(
          <PageLoader
            title="공개 수업 화면을 불러오는 중입니다"
            message="최신 공개 수업 정보를 준비하고 있습니다."
          />
        )}
      >
        <PublicClassListView
          classes={data.classes}
          isLoading={isDataBootstrapping}
          onLogin={() => setShowLogin(true)}
          showBackToDashboard={Boolean(user)}
          onBackToDashboard={() => setPublicModeAndSync(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );

  if (!user || isPublicMode) {
    return publicView;
  }

  if (isDataBootstrapping) {
    return (
      <PageLoader
        title="수업 데이터를 불러오는 중입니다"
        message="Supabase에서 최신 수업, 학생, 교재 정보를 가져오고 있습니다."
      />
    );
  }


  return (
    <div
      className={`app-layout ${isMobile ? 'app-layout-mobile' : ''} ${isTablet ? 'app-layout-tablet' : ''} ${showMinimalSidebar ? 'sidebar-hidden' : ''}`}
      data-design-system="toss-refresh"
      data-testid="app-shell-root"
    >
      {sidebarOpen && isCompact && (
        <div
          className="app-shell-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header sidebar-header-shell">
          <div className="sidebar-logo sidebar-logo-shell">
            <button
              type="button"
              className="sidebar-brand-button"
              onClick={goHome}
              aria-label="홈으로 이동"
            >
              <img
                src="/logo_tips.png"
                alt="TIPS Logo"
                className="sidebar-logo-mark sidebar-brand-mark"
              />
              <div className="sidebar-logo-text">
                <h1 className="sidebar-brand-title">
                  TIPS <span className="sidebar-brand-eyebrow">DASHBOARD</span>
                </h1>
              </div>
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label="테마 전환"
              title="테마 전환"
              onMouseEnter={(event) => openSidebarTooltip(event, '테마 전환')}
              onMouseLeave={closeSidebarTooltip}
              onFocus={(event) => openSidebarTooltip(event, '테마 전환')}
              onBlur={closeSidebarTooltip}
            >
              {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          {!showMinimalSidebar && !isMobile && statusBanner && (
            <StatusBanner
              compact
              eyebrow="시스템 상태"
              title={statusBanner.title}
              message={statusBanner.message}
              variant={statusBanner.variant}
            />
          )}

          {showMinimalSidebar ? (
            <div className="sidebar-mini-tools">
              <div className="sidebar-mini-tool-stack">
                <div className="sidebar-mini-menu">
                  <button
                    type="button"
                    className="sidebar-mini-menu-trigger"
                    aria-label="과목 선택"
                    aria-expanded={isSubjectFlyoutOpen}
                    onMouseEnter={openSubjectFlyout}
                    onMouseLeave={scheduleCloseSubjectFlyout}
                    onFocus={openSubjectFlyout}
                    onBlur={scheduleCloseSubjectFlyout}
                  >
                    영/수
                  </button>
                </div>

                {isStaff ? (
                  <button
                    type="button"
                    className="sidebar-mini-tool-button"
                    aria-label="학기 선택"
                    aria-expanded={isPeriodFlyoutOpen}
                    onClick={(event) => {
                      if (isPeriodFlyoutOpen) {
                        clearPeriodFlyoutCloseTimer();
                        setIsPeriodFlyoutOpen(false);
                        return;
                      }
                      openPeriodFlyout(event);
                    }}
                    onMouseEnter={openPeriodFlyout}
                    onMouseLeave={scheduleClosePeriodFlyout}
                    onFocus={openPeriodFlyout}
                    onBlur={scheduleClosePeriodFlyout}
                  >
                    <Calendar size={18} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <nav className="sidebar-nav">
          {visibleViews.map((view) => {
            const IconComponent = view.icon;
            const isActive = view.id === 'timetable' ? TIMETABLE_VIEW_IDS.includes(currentView) : currentView === view.id;
            return (
              <button
                key={view.id}
                type="button"
                data-testid={`sidebar-nav-${view.id}`}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  closeSidebarTooltip();
                  setIsSubjectFlyoutOpen(false);
                  if (view.id === 'curriculum-roadmap') {
                    openCurriculumRoadmap();
                    return;
                  }
                  if (view.id === 'data-manager') {
                    openDataManager();
                    return;
                  }
                  changeView(view.id === 'timetable' ? (TIMETABLE_VIEW_IDS.includes(currentView) ? currentView : 'class-list') : view.id);
                }}
                onMouseEnter={(event) => openSidebarTooltip(event, view.label)}
                onMouseLeave={closeSidebarTooltip}
                onFocus={(event) => openSidebarTooltip(event, view.label)}
                onBlur={closeSidebarTooltip}
              >
                <div className="sidebar-link-icon">
                  <IconComponent size={20} strokeWidth={2} />
                </div>
                <span>{view.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer sidebar-footer-shell">
          <button
            type="button"
            className="sidebar-nav-item sidebar-footer-action"
            aria-label="퍼블릭 뷰 보기"
            onClick={() => {
              closeSidebarTooltip();
              setPublicModeAndSync(true);
            }}
            onMouseEnter={(event) => openSidebarTooltip(event, '퍼블릭 뷰')}
            onMouseLeave={closeSidebarTooltip}
            onFocus={(event) => openSidebarTooltip(event, '퍼블릭 뷰')}
            onBlur={closeSidebarTooltip}
          >
            <div className="sidebar-link-icon">
              <Eye size={20} />
            </div>
            <span>퍼블릭 뷰 보기</span>
          </button>
          <button
            type="button"
            className="sidebar-nav-item sidebar-footer-action sidebar-footer-action-danger"
            aria-label="로그아웃"
            onClick={() => {
              closeSidebarTooltip();
              logout();
            }}
            onMouseEnter={(event) => openSidebarTooltip(event, '로그아웃')}
            onMouseLeave={closeSidebarTooltip}
            onFocus={(event) => openSidebarTooltip(event, '로그아웃')}
            onBlur={closeSidebarTooltip}
          >
            <div className="sidebar-link-icon sidebar-link-icon-danger">
              <LogOut size={20} />
            </div>
            <span>로그아웃</span>
          </button>
          {!showMinimalSidebar ? (
            <div className="sidebar-footer-note">
              © 2026 TIPS Academy
            </div>
          ) : null}
        </div>
      </aside>

      {showMinimalSidebar && isSubjectFlyoutOpen && subjectFlyoutAnchor ? (
        <div
          className="sidebar-fixed-flyout"
          role="menu"
          aria-label="과목 선택"
          style={{
            top: subjectFlyoutAnchor.top,
            left: subjectFlyoutAnchor.left,
          }}
          onMouseEnter={clearSubjectFlyoutCloseTimer}
          onMouseLeave={scheduleCloseSubjectFlyout}
        >
          {subjects.map((subject) => (
            <button
              key={subject}
              type="button"
              className={`sidebar-fixed-flyout-item ${selectedSubject === subject ? 'active' : ''}`}
              aria-pressed={selectedSubject === subject}
              aria-label={`과목 ${subject}`}
              onClick={() => {
                setSelectedSubject(subject);
                localStorage.setItem('selectedSubject', subject);
              }}
            >
              {subject}
            </button>
          ))}
        </div>
      ) : null}

      {showMinimalSidebar && isPeriodFlyoutOpen && periodFlyoutAnchor ? (
        <div
          className="sidebar-fixed-flyout"
          role="menu"
          aria-label="학기 선택"
          style={{
            top: periodFlyoutAnchor.top,
            left: periodFlyoutAnchor.left,
          }}
          onMouseEnter={clearPeriodFlyoutCloseTimer}
          onMouseLeave={scheduleClosePeriodFlyout}
        >
          {periods.map((period) => (
            <button
              key={period}
              type="button"
              className={`sidebar-fixed-flyout-item ${filterMode === 'period' && selectedPeriod === period ? 'active' : ''}`}
              aria-pressed={filterMode === 'period' && selectedPeriod === period}
              aria-label={`학기 ${period}`}
              onClick={() => selectPeriodFromFlyout(period)}
            >
              {period}
            </button>
          ))}
        </div>
      ) : null}

      {showMinimalSidebar && sidebarTooltip ? (
        <div
          className="sidebar-fixed-tooltip"
          style={{
            top: sidebarTooltip.top,
            left: sidebarTooltip.left,
          }}
        >
          {sidebarTooltip.label}
        </div>
      ) : null}

      <main className={`main-content ${isMobile ? 'main-content-mobile' : ''} ${isTablet ? 'main-content-tablet' : ''}`}>
        <div className="mobile-header mobile-header-shell">
          <div className="mobile-header-brand-row">
            <button
              type="button"
              data-testid="mobile-menu-button"
              className="btn-icon mobile-header-menu-button"
              onClick={() => setSidebarOpen(true)}
              aria-label="메뉴 열기"
              title="메뉴 열기"
            >
              <Menu size={24} />
            </button>
            <button
              type="button"
              className="mobile-header-brand"
              onClick={goHome}
              aria-label="홈으로 이동"
            >
              <img src="/logo_tips.png" alt="TIPS Logo" className="sidebar-logo-mark mobile-logo-mark mobile-header-brand-mark" />
              <div className="mobile-header-brand-copy">
                <h2 className="mobile-header-brand-title">TIPS DASHBOARD</h2>
                <span className="mobile-header-brand-eyebrow">{currentViewLabel}</span>
              </div>
            </button>
          </div>

          <div className="mobile-header-actions">
            <button type="button" className="theme-toggle" onClick={toggleTheme} title="테마 전환" aria-label="테마 전환">
              {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button type="button" className="btn-icon" onClick={() => setPublicModeAndSync(true)} title="퍼블릭 뷰 보기" aria-label="퍼블릭 뷰 보기">
              <Eye size={18} />
            </button>
            {!isMobile && (
              <div className="mobile-header-user">
                <span className="mobile-header-user-name">
                  {displayUserName}
                </span>
                <button type="button" className="btn-icon mobile-header-logout" onClick={logout} title="로그아웃" aria-label="로그아웃">
                  <LogOut size={20} />
                </button>
              </div>
            )}
          </div>
        </div>

        {statusBanner && isMobile && (
          <div className="shell-status-banner shell-status-banner-mobile">
            <StatusBanner
              compact
              eyebrow="시스템 상태"
              title={statusBanner.title}
              message={statusBanner.message}
              variant={statusBanner.variant}
            />
          </div>
        )}

        {statusBanner && showMinimalSidebar && !isMobile ? (
          <div className="shell-status-banner shell-status-banner-desktop">
            <StatusBanner
              compact
              eyebrow="시스템 상태"
              title={statusBanner.title}
              message={statusBanner.message}
              variant={statusBanner.variant}
            />
          </div>
        ) : null}

        <Suspense
          fallback={(
            <PageLoader
              title="화면을 불러오는 중입니다"
              message="선택한 대시보드 화면을 준비하고 있습니다."
            />
          )}
        >
          <div>
            {isMobile && isAcademicHubView && canAccessCurriculumRoadmap ? (
              <div className="app-mobile-academic-switcher workspace-tabs workspace-tabs-compact" data-testid="mobile-academic-switcher">
                <button
                  type="button"
                  className={`h-segment-btn workspace-tab-btn ${currentView === 'academic-calendar' ? 'active' : ''}`}
                  aria-pressed={currentView === 'academic-calendar'}
                  data-testid="mobile-academic-tab-calendar"
                  onClick={() => changeView('academic-calendar', { closeSidebar: false })}
                >
                  <CalendarDays size={16} className="workspace-tab-icon" />
                  <span>학사 일정</span>
                </button>
                <button
                  type="button"
                  className={`h-segment-btn workspace-tab-btn ${currentView === 'curriculum-roadmap' ? 'active' : ''}`}
                  aria-pressed={currentView === 'curriculum-roadmap'}
                  data-testid="mobile-academic-tab-roadmap"
                  onClick={() => openCurriculumRoadmap()}
                >
                  <BookOpen size={16} className="workspace-tab-icon" />
                  <span>교재·진도</span>
                </button>
              </div>
            ) : null}

            {TIMETABLE_VIEW_IDS.includes(currentView) && (
              <section
                className={`workspace-surface app-shell-panel ${currentView === 'class-list' ? 'workspace-surface-allow-overflow' : ''}`}
                data-testid="shell-timetable-section"
              >
                <div className={`app-shell-toolbar-stack ${isCompact ? 'is-mobile' : ''}`}>
                  {isCompact && isUnifiedTimetableView ? renderTimetableMobileSummary() : null}
                  {renderTimetableTabs({ compact: isCompact })}
                </div>
                {!isCompact && isUnifiedTimetableView ? renderUnifiedTimetableFilterPanel() : null}

                {currentView === 'class-list' && (
                  <ClassListWorkspace
                    classes={filteredClasses}
                    data={data}
                    dataService={activeDataService}
                    integrated
                    hideHeader
                  />
                )}
              </section>
            )}
            {currentView === 'stats' && (
              <StatsDashboard
                classes={data.classes || []}
                data={data}
                dataService={activeDataService}
                onViewStudentSchedule={openStudentSchedule}
              />
            )}
            {currentView === 'student-weekly' && (
              <StudentWeeklyView
                student={selectedStudent}
                students={data.students}
                classes={data.classes}
                data={data}
                dataService={activeDataService}
                onSelectStudent={setSelectedStudentId}
                embedded
              />
            )}
            {currentView === 'classroom-weekly' && (
              <ClassroomWeeklyView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                onViewStudentSchedule={openStudentSchedule}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedClassroomNames={timetableFilters.classroom}
              />
            )}
            {currentView === 'teacher-weekly' && (
              <TeacherWeeklyView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                onViewStudentSchedule={openStudentSchedule}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedTeacherNames={timetableFilters.teacher}
              />
            )}
            {currentView === 'daily-classroom' && (
              <DailyClassroomView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedClassroomNames={timetableFilters.classroom}
              />
            )}
            {currentView === 'daily-teacher' && (
              <DailyTeacherView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedTeacherNames={timetableFilters.teacher}
              />
            )}
            {currentView === 'academic-calendar' && (
              <AcademicCalendarView
                data={data}
                dataService={activeDataService}
                onOpenRoadmap={openCurriculumRoadmap}
                navigationIntent={academicCalendarIntent}
              />
            )}
            {currentView === 'curriculum-roadmap' && (
              <CurriculumRoadmapView
                data={data}
                dataService={activeDataService}
                navigationIntent={curriculumRoadmapIntent}
                onOpenAcademicCalendar={openAcademicCalendar}
              />
            )}
            {currentView === 'data-manager' && (
              <DataManager
                data={data}
                dataService={activeDataService}
                onOpenCurriculum={() => openCurriculumRoadmap()}
                onOpenTermManager={() => setIsTermManagerOpen(true)}
                navigationIntent={dataManagerIntent}
              />
            )}
          </div>
        </Suspense>
      </main>

      <TermManagerModal
        open={isTermManagerOpen}
        terms={managedTerms}
        classes={data.classes || []}
        dataService={activeDataService}
        currentTermPreference={currentTermPreference}
        onClose={() => setIsTermManagerOpen(false)}
        onSaved={(savedTerms = [], nextCurrentTerm = null) => {
          setLocalTerms(savedTerms || []);
          persistCurrentTermPreference(nextCurrentTerm);
          setIsTermManagerOpen(false);
        }}
      />

      <BottomSheet
        open={Boolean(isCompact && isUnifiedTimetableView && isTimetableFilterSheetOpen)}
        onClose={() => setIsTimetableFilterSheetOpen(false)}
        title="시간표 필터"
        subtitle="학기, 날짜, 과목 기준을 한 화면에서 조정할 수 있습니다."
        testId="timetable-filter-sheet"
      >
        <div className="timetable-filter-sheet-stack">
          {renderUnifiedTimetableFilterPanel({ compact: true })}
        </div>
      </BottomSheet>

      {isMobile && user && !isPublicMode && (
        <nav className="mobile-bottom-nav">
          {[
            { id: 'stats', label: '개요', icon: <BarChart2 size={18} /> },
            { id: 'timetable', label: '시간표', icon: <LayoutGrid size={18} /> },
            { id: 'academic-calendar', label: '학사·진도', icon: <CalendarDays size={18} /> },
            { id: 'data-manager', label: '데이터 관리', icon: <ClipboardList size={18} />, disabled: !isStaff },
          ].map((item) => (
              <button
              key={item.id}
              type="button"
              data-testid={`mobile-nav-${item.id}`}
              className={`mobile-bottom-nav-item ${activeMobileTab === item.id ? 'active' : ''}`}
              aria-current={activeMobileTab === item.id ? 'page' : undefined}
              aria-label={item.label}
              onClick={() => !item.disabled && navigateMobileTab(item.id)}
              disabled={item.disabled}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
