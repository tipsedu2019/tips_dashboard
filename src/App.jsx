import { Suspense, lazy, startTransition, useEffect, useMemo, useState } from 'react';
import {
  BarChart2,
  BookOpen,
  Building2,
  Calendar,
  LayoutGrid,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import LoginModal from './components/SettingsModal';
import PageLoader from './components/ui/PageLoader';
import StatusBanner from './components/ui/StatusBanner';
import TermManagerModal from './components/ui/TermManagerModal';
import ViewHeader from './components/ui/ViewHeader';
import useViewport from './hooks/useViewport';
import {
  ACTIVE_CLASS_STATUS,
  computeClassStatus,
} from './lib/classStatus';
import { sortSubjectOptions } from './lib/subjectUtils';

const ClassroomWeeklyView = lazy(() => import('./components/ClassroomWeeklyView'));
const TeacherWeeklyView = lazy(() => import('./components/TeacherWeeklyView'));
const DailyClassroomView = lazy(() => import('./components/DailyClassroomView'));
const DailyTeacherView = lazy(() => import('./components/DailyTeacherView'));
const DataManager = lazy(() => import('./components/DataManager'));
const StudentWeeklyView = lazy(() => import('./components/StudentWeeklyView'));
const AcademicCalendarView = lazy(() => import('./components/AcademicCalendarView'));
const CurriculumDashboardView = lazy(() => import('./components/CurriculumDashboardView'));
const PublicClassListView = lazy(() => import('./components/PublicClassListView'));
const ClassListWorkspace = lazy(() => import('./components/ClassListWorkspace'));
const StatsDashboard = lazy(() => import('./components/StatsDashboard'));

const ALL_OPTION = '전체';
const LOCAL_TERM_STORAGE_KEY = 'tips-dashboard:local-terms';
const TIMETABLE_VIEW_IDS = ['class-list', 'teacher-weekly', 'classroom-weekly', 'daily-teacher', 'daily-classroom', 'student-weekly'];
const TIMETABLE_TABS = [
  {
    id: 'class-list',
    label: '전체 수업 목록',
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
  { id: 'curriculum-dashboard', label: '교재 정보', icon: BookOpen, staffOnly: true },
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
  const [currentView, setCurrentView] = useState('stats');
  const [data, setData] = useState({
    classes: [],
    students: [],
    textbooks: [],
    progressLogs: [],
    classTerms: [],
    academicEvents: [],
    academicSchools: [],
    academicCurriculumProfiles: [],
    academicSupplementMaterials: [],
    academicEventExamDetails: [],
    academicExamDays: [],
    academicExamScopes: [],
    academyCurriculumPlans: [],
    academyCurriculumMaterials: [],
    isConnected: false,
    isLoading: true,
    lastUpdated: null,
    error: null,
  });
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterMode, setFilterMode] = useState('date');
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [selectedPeriod, setSelectedPeriod] = useState(ALL_OPTION);
  const [selectedSubject, setSelectedSubject] = useState(ALL_OPTION);
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const [isTermManagerOpen, setIsTermManagerOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [isPublicMode, setIsPublicMode] = useState(() => getPublicModeFromLocation());
  const [isTimetableFloatingCollapsed, setIsTimetableFloatingCollapsed] = useState(() => localStorage.getItem('tips-timetable-floating-collapsed') === '1');
  const [localTerms, setLocalTerms] = useState(() => {
    try {
      const raw = localStorage.getItem(LOCAL_TERM_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const { user, isStaff, logout, loading, authError } = useAuth();
  const showMinimalSidebar = !isCompact;

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

  useEffect(() => {
    const savedMode = localStorage.getItem('filterMode');
    const savedDate = localStorage.getItem('selectedDate');
    const savedPeriod = localStorage.getItem('selectedPeriod');
    const savedSubject = localStorage.getItem('selectedSubject');
    if (savedMode) setFilterMode(savedMode);
    if (savedDate) setSelectedDate(savedDate);
    if (savedPeriod) setSelectedPeriod(savedPeriod);
    if (savedSubject) setSelectedSubject(savedSubject);
  }, []);

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
    const unsubscribe = dataService.subscribe(setData);
    return unsubscribe;
  }, []);

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
    dataService.normalizeLegacyClassrooms(data.classes)
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
  }, [data.classes, data.isLoading, isStaff]);

  useEffect(() => {
    if (currentView === 'planner') {
      changeView('class-list', { closeSidebar: false });
    }
  }, [currentView]);

  useEffect(() => {
    if (user && !isStaff && (currentView === 'data-manager' || currentView === 'curriculum-dashboard')) {
      changeView('stats', { closeSidebar: false });
    }
  }, [currentView, isStaff, user]);

  const selectedStudent = useMemo(() => (
    data.students?.find((student) => student.id === selectedStudentId) || null
  ), [data.students, selectedStudentId]);

  const periods = useMemo(() => {
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

    return [ALL_OPTION, ...Array.from(values).sort((left, right) => left.localeCompare(right, 'ko'))];
  }, [data.classTerms, data.classes, localTerms]);

  const subjects = useMemo(() => (
    [ALL_OPTION, ...sortSubjectOptions(
      data.classes.map((classItem) => classItem.subject).filter(Boolean),
      { includeDefaults: false }
    )]
  ), [data.classes]);

  useEffect(() => {
    if (!periods.includes(selectedPeriod)) {
      setSelectedPeriod(ALL_OPTION);
      localStorage.setItem('selectedPeriod', ALL_OPTION);
    }
  }, [periods, selectedPeriod]);

  useEffect(() => {
    if (!subjects.includes(selectedSubject)) {
      setSelectedSubject(ALL_OPTION);
      localStorage.setItem('selectedSubject', ALL_OPTION);
    }
  }, [selectedSubject, subjects]);

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

  const managedTerms = useMemo(() => {
    const result = [];
    const knownNames = new Set();

    [...(data.classTerms || []), ...(localTerms || [])].forEach((term, index) => {
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

    periods
      .filter((period) => period !== ALL_OPTION)
      .forEach((period, index) => {
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
  }, [data.classTerms, localTerms, periodMeta, periods]);

  const classesMatchingBaseFilters = useMemo(() => {
    let nextClasses = data.classes;

    if (selectedSubject !== ALL_OPTION) {
      nextClasses = nextClasses.filter((classItem) => classItem.subject === selectedSubject);
    }

    if (filterMode === 'all') return nextClasses;

    if (filterMode === 'period') {
      if (selectedPeriod === ALL_OPTION) return nextClasses;
      return nextClasses.filter((classItem) => {
        const classPeriod = classItem.period || '';
        const classTermName = managedTerms.find((term) => String(term.id) === String(classItem.termId))?.name || '';
        return classPeriod === selectedPeriod || classTermName === selectedPeriod;
      });
    }

    const targetDate = parseLocalDate(selectedDate);
    if (!targetDate) return nextClasses;

    return nextClasses.filter((classItem) => {
      const startDate = parseLocalDate(classItem.startDate);
      const endDate = parseLocalDate(classItem.endDate);

      if (!startDate && !endDate) return true;
      if (startDate && targetDate < startDate) return false;
      if (endDate) {
        const endOfDay = new Date(endDate.getTime());
        endOfDay.setHours(23, 59, 59, 999);
        if (targetDate > endOfDay) return false;
      }

      return true;
    });
  }, [data.classes, filterMode, selectedDate, selectedPeriod, selectedSubject]);

  const filteredClasses = useMemo(() => classesMatchingBaseFilters, [classesMatchingBaseFilters]);
  const weeklyAxisClasses = useMemo(() => classesMatchingBaseFilters, [classesMatchingBaseFilters]);

  const statusBanner = useMemo(() => buildStatusBanner(authError, data), [authError, data]);
  const visibleViews = useMemo(() => (
    NAV_VIEWS.filter((view) => !view.staffOnly || isStaff)
  ), [isStaff]);
  const currentViewMeta = useMemo(
    () => visibleViews.find((view) => view.id === (TIMETABLE_VIEW_IDS.includes(currentView) ? 'timetable' : currentView)) || NAV_VIEWS[0],
    [currentView, visibleViews]
  );
  const currentTimetableTab = useMemo(
    () => TIMETABLE_TABS.find((tab) => tab.id === currentView) || TIMETABLE_TABS[0],
    [currentView]
  );
  const TimetableHeaderIcon = currentTimetableTab.icon || Calendar;
  const currentViewLabel = TIMETABLE_VIEW_IDS.includes(currentView) ? currentTimetableTab.label : currentViewMeta.label;
  const activeMobileTab = useMemo(() => {
    if (TIMETABLE_VIEW_IDS.includes(currentView)) {
      return 'timetable';
    }

    if (currentView === 'academic-calendar') {
      return 'academic-calendar';
    }

    if (currentView === 'curriculum-dashboard') {
      return 'data-manager';
    }

    if (currentView === 'data-manager') {
      return 'data-manager';
    }

    return 'stats';
  }, [currentView]);

  const displayUserName = user?.name || user?.email || '사용자';
  const isDataBootstrapping = data.isLoading && !data.lastUpdated;
  const timetableDefaultStatus =
    filterMode === 'period' && selectedPeriod !== ALL_OPTION
      ? (periodMeta[selectedPeriod]?.status || ACTIVE_CLASS_STATUS)
      : ACTIVE_CLASS_STATUS;
  const timetableDefaultPeriod = filterMode === 'period' && selectedPeriod !== ALL_OPTION ? selectedPeriod : '';

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  const navigateMobileTab = (tabId) => {
    if (tabId === 'timetable') {
      startTransition(() => {
        setCurrentView((current) => (TIMETABLE_VIEW_IDS.includes(current) ? current : 'class-list'));
      });
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
    <div className={`workspace-tabs ${compact ? 'workspace-tabs-compact' : ''}`}>
      {TIMETABLE_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className={`h-segment-btn ${currentView === tab.id ? 'active' : ''}`}
            onClick={() => changeView(tab.id, { closeSidebar: false })}
            style={{ minHeight: compact ? 42 : 48, justifyContent: 'center' }}
          >
            <Icon size={16} style={{ marginRight: 8 }} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  const renderPeriodDropdown = () => (
    <div style={{ position: 'relative' }}>
      <button
        className="custom-dropdown-btn"
        onClick={() => setIsPeriodDropdownOpen((current) => !current)}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedPeriod}</span>
        <ChevronDown
          size={16}
          style={{
            color: 'var(--text-secondary)',
            transform: isPeriodDropdownOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>
      {isPeriodDropdownOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setIsPeriodDropdownOpen(false)} />
          <div className="custom-dropdown-menu animate-in" style={{ zIndex: 100 }}>
            <div className="dropdown-scroll-area">
              {periods.map((period) => (
                <button
                  key={period}
                  className={`custom-dropdown-item ${selectedPeriod === period ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedPeriod(period);
                    localStorage.setItem('selectedPeriod', period);
                    setIsPeriodDropdownOpen(false);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span>{period}</span>
                    {period !== ALL_OPTION && periodMeta[period]?.status ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'rgba(33, 110, 78, 0.12)',
                          color: 'var(--accent-color)',
                          fontSize: 10,
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {periodMeta[period].status}
                      </span>
                    ) : null}
                  </div>
                  {period !== ALL_OPTION && periodMeta[period] && (
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
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
          className="action-chip"
          onClick={() => setIsTermManagerOpen(true)}
          style={{ width: compact ? 'auto' : '100%', justifyContent: 'center' }}
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

  const renderFloatingTimetableMenu = () => {
    if (isTimetableFloatingCollapsed) {
      return (
        <div className="timetable-floating-rail">
          <button
            type="button"
            className="timetable-floating-rail-button"
            onClick={() => {
              setIsTimetableFloatingCollapsed(false);
              localStorage.setItem('tips-timetable-floating-collapsed', '0');
            }}
          >
            <ChevronRight size={16} />
            시간표 패널
          </button>
        </div>
      );
    }

    return (
      <div className="timetable-floating-filter">
        <div className="timetable-floating-shell">
          <div className="timetable-floating-header">
            <div className="timetable-floating-title">시간표 패널</div>
            <button
              type="button"
              className="action-chip"
              onClick={() => {
                setIsTimetableFloatingCollapsed(true);
                localStorage.setItem('tips-timetable-floating-collapsed', '1');
              }}
            >
              <ChevronLeft size={14} />
              접기
            </button>
          </div>
          <div className="timetable-floating-topline">
            <div className="timetable-floating-tabs">
              {renderTimetableTabs({ compact: true })}
            </div>
          </div>
          <div id="timetable-floating-slot" className="timetable-floating-slot" />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <PageLoader
        title="TIPS 대시보드를 준비하고 있습니다"
        message="계정 상태를 확인하고 최신 시간표와 데이터를 불러오는 중입니다."
      />
    );
  }

  const publicView = (
    <>
      {statusBanner && (
        <div
          style={{
            position: 'fixed',
            top: 92,
            left: 16,
            width: 'min(420px, calc(100vw - 32px))',
            zIndex: 1200,
            pointerEvents: 'none',
          }}
        >
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
        />
      </Suspense>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
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
    <div className={`app-layout ${isMobile ? 'app-layout-mobile' : ''} ${isTablet ? 'app-layout-tablet' : ''} ${showMinimalSidebar ? 'sidebar-hidden' : ''}`}>
      {sidebarOpen && isCompact && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sidebar-logo" style={{ marginBottom: 0, gap: 10 }}>
            <button
              type="button"
              onClick={goHome}
              style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              <img
                src="/logo_tips.png"
                alt="TIPS Logo"
                className="sidebar-logo-mark"
                style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain' }}
              />
              <div className="sidebar-logo-text">
                <h1 style={{ margin: 0, lineHeight: '1.2' }}>
                  TIPS <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>DASHBOARD</span>
                </h1>
              </div>
            </button>
            <button className="theme-toggle" onClick={toggleTheme} style={{ marginLeft: 'auto' }} title="테마 전환">
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
                    title="과목 선택"
                    aria-label="과목 선택"
                    data-tooltip="과목 선택"
                  >
                    영/수
                  </button>
                  <div className="sidebar-mini-menu-popover" role="menu" aria-label="과목 선택">
                    {subjects.map((subject) => (
                      <button
                        key={subject}
                        type="button"
                        className={`sidebar-mini-menu-item ${selectedSubject === subject ? 'active' : ''}`}
                        title={subject}
                        onClick={() => {
                          setSelectedSubject(subject);
                          localStorage.setItem('selectedSubject', subject);
                        }}
                      >
                        {subject}
                      </button>
                    ))}
                  </div>
                </div>

                {isStaff ? (
                  <button
                    type="button"
                    className="sidebar-mini-tool-button"
                    onClick={() => setIsTermManagerOpen(true)}
                    data-tooltip="학기 관리"
                    aria-label="학기 관리"
                    title="학기 관리"
                  >
                    <Calendar size={18} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            renderTimetableFilterPanel()
          )}
        </div>

        <nav className="sidebar-nav">
          {visibleViews.map((view) => {
            const IconComponent = view.icon;
            const isActive = view.id === 'timetable' ? TIMETABLE_VIEW_IDS.includes(currentView) : currentView === view.id;
            return (
              <button
                key={view.id}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                title={view.label}
                data-tooltip={showMinimalSidebar ? view.label : undefined}
                onClick={() => {
                  changeView(view.id === 'timetable' ? (TIMETABLE_VIEW_IDS.includes(currentView) ? currentView : 'class-list') : view.id);
                }}
              >
                <div className="sidebar-link-icon">
                  <IconComponent size={20} strokeWidth={2} />
                </div>
                <span>{view.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer" style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            className="sidebar-nav-item"
            style={{ width: '100%' }}
            title="퍼블릭 뷰 보기"
            data-tooltip={showMinimalSidebar ? '퍼블릭 뷰' : undefined}
            onClick={() => setPublicModeAndSync(true)}
          >
            <div className="sidebar-link-icon">
              <Eye size={20} />
            </div>
            <span>퍼블릭 뷰 보기</span>
          </button>
          <button
            className="sidebar-nav-item"
            style={{
              width: '100%',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              background: 'rgba(239, 68, 68, 0.05)',
            }}
            title="로그아웃"
            data-tooltip={showMinimalSidebar ? '로그아웃' : undefined}
            onClick={logout}
          >
            <div className="sidebar-link-icon" style={{ color: '#ef4444' }}>
              <LogOut size={20} />
            </div>
            <span>로그아웃</span>
          </button>
          {!showMinimalSidebar ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              © 2026 TIPS Academy
            </div>
          ) : null}
        </div>
      </aside>

      <main className={`main-content ${isMobile ? 'main-content-mobile' : ''} ${isTablet ? 'main-content-tablet' : ''}`}>
        {!isCompact && TIMETABLE_VIEW_IDS.includes(currentView) && renderFloatingTimetableMenu()}
        <div className="mobile-header" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="btn-icon" onClick={() => setSidebarOpen(true)} style={{ background: 'var(--bg-surface-hover)' }}>
              <Menu size={24} />
            </button>
            <button
              type="button"
              onClick={goHome}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
            >
              <img src="/logo_tips.png" alt="TIPS Logo" className="sidebar-logo-mark mobile-logo-mark" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>TIPS DASHBOARD</h2>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{currentViewLabel}</span>
              </div>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="theme-toggle" onClick={toggleTheme} title="테마 전환">
              {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="btn-icon" onClick={() => setPublicModeAndSync(true)} title="퍼블릭 뷰 보기">
              <Eye size={18} />
            </button>
            {!isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {displayUserName}
                </span>
                <button className="btn-icon" onClick={logout} title="로그아웃" style={{ color: '#ef4444' }}>
                  <LogOut size={20} />
                </button>
              </div>
            )}
          </div>
        </div>

        {statusBanner && isMobile && (
          <div style={{ marginBottom: 20, maxWidth: 560 }}>
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
          <div style={{ marginBottom: 20, maxWidth: 640 }}>
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
            {TIMETABLE_VIEW_IDS.includes(currentView) && (
              <section className="workspace-surface" style={{ padding: 24, display: 'grid', gap: 18, marginBottom: 24 }}>
                <ViewHeader
                  icon={<TimetableHeaderIcon size={22} />}
                  eyebrow="시간표 워크스페이스"
                  title={currentTimetableTab.label}
                  description={currentTimetableTab.description}
                />

                {isCompact && renderTimetableTabs()}
              </section>
            )}
            {currentView === 'stats' && (
              <StatsDashboard
                classes={filteredClasses}
                data={data}
                dataService={dataService}
                onViewStudentSchedule={openStudentSchedule}
              />
            )}
            {currentView === 'class-list' && (
              <ClassListWorkspace
                classes={filteredClasses}
                data={data}
                dataService={dataService}
              />
            )}
            {currentView === 'student-weekly' && (
              <StudentWeeklyView
                student={selectedStudent}
                students={data.students}
                classes={data.classes}
                data={data}
                dataService={dataService}
                onSelectStudent={setSelectedStudentId}
                embedded
              />
            )}
            {currentView === 'classroom-weekly' && (
              <ClassroomWeeklyView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={dataService}
                onViewStudentSchedule={openStudentSchedule}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={selectedPeriod !== ALL_OPTION ? selectedPeriod : timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={!isCompact && !isTimetableFloatingCollapsed}
                subjectOptions={subjects}
                selectedSubject={selectedSubject}
                onSelectSubject={(subject) => {
                  setSelectedSubject(subject);
                  localStorage.setItem('selectedSubject', subject);
                }}
              />
            )}
            {currentView === 'teacher-weekly' && (
              <TeacherWeeklyView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={dataService}
                onViewStudentSchedule={openStudentSchedule}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={selectedPeriod !== ALL_OPTION ? selectedPeriod : timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={!isCompact && !isTimetableFloatingCollapsed}
                subjectOptions={subjects}
                selectedSubject={selectedSubject}
                onSelectSubject={(subject) => {
                  setSelectedSubject(subject);
                  localStorage.setItem('selectedSubject', subject);
                }}
              />
            )}
            {currentView === 'daily-classroom' && (
              <DailyClassroomView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={dataService}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={selectedPeriod !== ALL_OPTION ? selectedPeriod : timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={!isCompact && !isTimetableFloatingCollapsed}
                subjectOptions={subjects}
                selectedSubject={selectedSubject}
                onSelectSubject={(subject) => {
                  setSelectedSubject(subject);
                  localStorage.setItem('selectedSubject', subject);
                }}
              />
            )}
            {currentView === 'daily-teacher' && (
              <DailyTeacherView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={dataService}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={selectedPeriod !== ALL_OPTION ? selectedPeriod : timetableDefaultPeriod || 'workspace'}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={!isCompact && !isTimetableFloatingCollapsed}
                subjectOptions={subjects}
                selectedSubject={selectedSubject}
                onSelectSubject={(subject) => {
                  setSelectedSubject(subject);
                  localStorage.setItem('selectedSubject', subject);
                }}
              />
            )}
            {currentView === 'academic-calendar' && (
              <AcademicCalendarView data={data} dataService={dataService} />
            )}
            {currentView === 'curriculum-dashboard' && (
              <CurriculumDashboardView data={data} dataService={dataService} />
            )}
            {currentView === 'data-manager' && (
              <DataManager
                data={data}
                dataService={dataService}
                onOpenCurriculum={() => changeView('curriculum-dashboard', { closeSidebar: false })}
              />
            )}
          </div>
        </Suspense>
      </main>

      <TermManagerModal
        open={isTermManagerOpen}
        terms={managedTerms}
        classes={data.classes || []}
        dataService={dataService}
        onClose={() => setIsTermManagerOpen(false)}
        onSaved={(savedTerms = []) => {
          setLocalTerms((savedTerms || []).filter((term) => term?.localOnly));
          setIsTermManagerOpen(false);
        }}
      />

      {isMobile && user && !isPublicMode && (
        <nav className="mobile-bottom-nav">
          {[
            { id: 'stats', label: '개요', icon: <BarChart2 size={18} /> },
            { id: 'timetable', label: '시간표', icon: <LayoutGrid size={18} /> },
            { id: 'academic-calendar', label: '학사 일정', icon: <CalendarDays size={18} /> },
            { id: 'data-manager', label: '데이터 관리', icon: <ClipboardList size={18} />, disabled: !isStaff },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`mobile-bottom-nav-item ${activeMobileTab === item.id ? 'active' : ''}`}
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
