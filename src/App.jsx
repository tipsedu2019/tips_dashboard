import { useState, useEffect, useMemo } from 'react';
import { BarChart2, Building2, Users, Landmark, Sun, Moon, LogIn, LogOut, ChevronDown, Calendar, BookOpen, ClipboardList, Menu, User, ArrowLeft } from 'lucide-react';
import { dataService } from './services/dataService';
import { useAuth } from './contexts/AuthContext';
import StatsDashboard from './components/StatsDashboard';
import ClassroomWeeklyView from './components/ClassroomWeeklyView';
import TeacherWeeklyView from './components/TeacherWeeklyView';
import DailyClassroomView from './components/DailyClassroomView';
import DailyTeacherView from './components/DailyTeacherView';
import LoginModal from './components/SettingsModal';
import DataManager from './components/DataManager';
import PublicClassListView from './components/PublicClassListView';
import StudentWeeklyView from './components/StudentWeeklyView';
import ReferenceMaterials from './components/ReferenceMaterials';
import AcademicCalendarView from './components/AcademicCalendarView';

const VIEWS = [
  { id: 'stats',            label: '종합 대시보드',        icon: BarChart2  },
  { id: 'student-weekly',   label: '학생별 주간 스케줄',    icon: User       },
  { id: 'classroom-weekly', label: '강의실별 주간 스케줄', icon: Building2  },
  { id: 'teacher-weekly',  label: '선생님별 주간 스케줄', icon: Users     },
  { id: 'daily-classroom', label: '요일별 강의실 스케줄', icon: Building2  },
  { id: 'daily-teacher',   label: '요일별 선생님 스케줄', icon: Users     },
  { id: 'academic-calendar', label: '통합 학사 일정 캘린더', icon: Calendar  },
  { id: 'reference-materials', label: '학사 일정 및 참고 자료', icon: BookOpen },
  { id: 'data-manager',    label: '통합 데이터 관리',   icon: ClipboardList },
];

// YYYY-MM-DD 문자열을 Date 객체로 변환 (로컬 타임존 기준)
function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function App() {
  const [currentView, setCurrentView] = useState('stats');
  const [data, setData] = useState({
    classes: [],
    students: [],
    isConnected: false,
    isLoading: false,
    lastUpdated: null,
  });

  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const selectedStudent = useMemo(() => {
    return data.students?.find(s => s.id === selectedStudentId);
  }, [data.students, selectedStudentId]);

  const { user, isStaff, logout } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  // Redirect teachers away from Data Manager
  useEffect(() => {
    if (user && !isStaff && currentView === 'data-manager') {
      setCurrentView('stats');
    }
  }, [user, isStaff, currentView]);

  // 날짜 필터 (기본: 오늘)
  const today = useMemo(() => new Date(), []);
  const [filterMode, setFilterMode] = useState('date'); // 'date' | 'period' | 'all'
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [selectedPeriod, setSelectedPeriod] = useState('전체');
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);

  const [selectedSubject, setSelectedSubject] = useState('전체');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

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

  const periods = useMemo(() => {
    const set = new Set(data.classes.map(c => c.period || '미분류'));
    return ['전체', ...[...set].sort()];
  }, [data.classes]);

  // 과목 목록 추출
  const subjects = useMemo(() => ['전체', '영어', '수학'], []);

  const periodMeta = useMemo(() => {
    const meta = {};
    data.classes.forEach(c => {
      const p = c.period || '미분류';
      if (!meta[p]) meta[p] = { startDate: c.startDate, endDate: c.endDate };
    });
    return meta;
  }, [data.classes]);

  const filteredClasses = useMemo(() => {
    let base = data.classes;
    if (selectedSubject !== '전체') {
      base = base.filter(c => c.subject === selectedSubject);
    }
    if (filterMode === 'all') return base;
    if (filterMode === 'period') {
      if (selectedPeriod === '전체') return base;
      return base.filter(c => (c.period || '미분류') === selectedPeriod);
    }
    if (filterMode === 'date') {
      const targetDate = parseLocalDate(selectedDate);
      if (!targetDate) return base;
      return base.filter(c => {
        const start = parseLocalDate(c.startDate);
        const end = parseLocalDate(c.endDate);
        if (!start && !end) return true;
        if (start && targetDate < start) return false;
        if (end) {
          end.setHours(23, 59, 59, 999);
          if (targetDate > end) return false;
        }
        return true;
      });
    }
    return base;
  }, [data.classes, filterMode, selectedDate, selectedPeriod, selectedSubject]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  useEffect(() => {
    const unsub = dataService.subscribe(setData);
    return unsub;
  }, []);

  const handleFilterModeChange = (mode) => {
    setFilterMode(mode);
    localStorage.setItem('filterMode', mode);
  };

  const isPublicParam = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'public';
  }, []);

  // Security Guard: If not logged in, always show Public View
  if (!user) {
    return (
      <>
        <PublicClassListView classes={data.classes} onLogin={() => setShowLogin(true)} />
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </>
    );
  }

  // If user is logged in but specifically requested public view (via URL)
  if (isPublicParam) {
    return (
      <>
        <PublicClassListView classes={data.classes} onLogin={() => setShowLogin(true)} />
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </>
    );
  }

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sidebar-logo" style={{ marginBottom: 0, gap: 10 }}>
            <img src="/logo_tips.png" alt="TIPS Logo" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain' }} />
            <div className="sidebar-logo-text">
              <h1 style={{ margin: 0, lineHeight: '1.2' }}>TIPS <span style={{fontSize:12, fontWeight:500, color:'var(--text-muted)'}}>DASHBOARD</span></h1>
            </div>
            <button className="theme-toggle" onClick={toggleTheme} style={{ marginLeft: 'auto' }} title="테마 변경">
              {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          {/* ── 기간 필터 섹션 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              스케줄 필터
            </label>
            <div className="h-segment-container">
              {[
                { id: 'all', label: '전체' },
                { id: 'period', label: '학기' },
                { id: 'date', label: '날짜' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => handleFilterModeChange(tab.id)}
                  className={`h-segment-btn ${filterMode === tab.id ? 'active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 날짜 선택 모드 */}
            {filterMode === 'date' && (
              <div>
                <input
                  type="date"
                  value={selectedDate}
                  className="styled-date-input"
                  onChange={e => {
                    setSelectedDate(e.target.value);
                    localStorage.setItem('selectedDate', e.target.value);
                  }}
                />
              </div>
            )}

            {/* 학기 선택 모드 */}
            {filterMode === 'period' && (
              <div style={{ position: 'relative' }}>
                <button
                  className="custom-dropdown-btn"
                  onClick={() => setIsPeriodDropdownOpen(!isPeriodDropdownOpen)}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedPeriod}</span>
                  <ChevronDown size={16} style={{ color: 'var(--text-secondary)', transform: isPeriodDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                </button>
                {isPeriodDropdownOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setIsPeriodDropdownOpen(false)} />
                    <div className="custom-dropdown-menu animate-in" style={{ zIndex: 100 }}>
                      <div className="dropdown-scroll-area">
                        {periods.map(p => (
                          <button
                            key={p}
                            className={`custom-dropdown-item ${selectedPeriod === p ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedPeriod(p);
                              localStorage.setItem('selectedPeriod', p);
                              setIsPeriodDropdownOpen(false);
                            }}
                          >
                            <div>{p}</div>
                            {p !== '전체' && periodMeta[p] && (
                              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{periodMeta[p].startDate || '?'} ~ {periodMeta[p].endDate || '?'}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, paddingLeft: 4 }}>
              {filteredClasses.length}개의 수업 선택됨
            </div>
          </div>
          
          {/* ―― 과목(subject) 필터 ―― */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              과목 필터
            </label>
            <div className="h-segment-container">
              {subjects.map(s => (
                <button
                  key={s}
                  onClick={() => {
                    setSelectedSubject(s);
                    localStorage.setItem('selectedSubject', s);
                  }}
                  className={`h-segment-btn ${selectedSubject === s ? 'active' : ''}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, paddingLeft: 4, marginTop: 4 }}>
              {filteredClasses.length}개의 수업 선택됨
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-section">기본 스케줄 조회</div>
          {VIEWS.filter(v => v.id !== 'data-manager').map(view => {
            const IconComponent = view.icon;
            return (
              <button
                key={view.id}
                className={`sidebar-nav-item ${currentView === view.id ? 'active' : ''}`}
                onClick={() => {
                  setCurrentView(view.id);
                  setSidebarOpen(false);
                }}
              >
                <div className="sidebar-link-icon"><IconComponent size={20} strokeWidth={2} /></div>
                {view.label}
              </button>
            );
          })}
          
          {isStaff && (
            <>
              <div className="sidebar-nav-section" style={{ marginTop: 24 }}>관리자 전용</div>
              {VIEWS.filter(v => v.id === 'data-manager').map(view => {
                const IconComponent = view.icon;
                return (
                  <button
                    key={view.id}
                    className={`sidebar-nav-item ${currentView === view.id ? 'active' : ''}`}
                    onClick={() => {
                      setCurrentView(view.id);
                      setSidebarOpen(false);
                    }}
                  >
                    <div className="sidebar-link-icon"><IconComponent size={20} strokeWidth={2} /></div>
                    {view.label}
                  </button>
                );
              })}
            </>
          )}
        </nav>

        <div className="sidebar-footer" style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button 
            className="sidebar-nav-item" 
            style={{ width: '100%', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)' }} 
            onClick={logout}
          >
            <div className="sidebar-link-icon" style={{ color: '#ef4444' }}><LogOut size={20} /></div>
            로그아웃
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            © 2026 TIPS Academy
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-header" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="btn-icon" onClick={() => setSidebarOpen(true)} style={{ background: 'var(--bg-surface-hover)' }}>
              <Menu size={24} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
              <img src="/logo_tips.png" alt="TIPS Logo" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }} />
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>TIPS DASHBOARD</h2>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="theme-toggle" onClick={toggleTheme} title="테마 변경">
              {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{user.name}님</span>
                <button className="btn-icon" onClick={logout} title="로그아웃" style={{ color: '#ef4444' }}>
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button className="btn-primary" onClick={() => setShowLogin(true)} style={{ padding: '6px 16px', fontSize: 13, borderRadius: 10 }}>
                로그인
              </button>
            )}
          </div>
        </div>

        <div key={`${currentView}-${filterMode}-${selectedDate}-${selectedPeriod}-${selectedSubject}`}>
          {currentView === 'stats' && <StatsDashboard 
            classes={filteredClasses} 
            data={data} 
            onViewStudentSchedule={(sid) => {
              setSelectedStudentId(sid);
              setCurrentView('student-weekly');
            }}
          />}
          {currentView === 'student-weekly' && <StudentWeeklyView 
            student={selectedStudent} 
            students={data.students}
            onSelectStudent={setSelectedStudentId}
            classes={data.classes} 
            onBack={() => setCurrentView('stats')}
          />}
          {currentView === 'classroom-weekly' && <ClassroomWeeklyView 
            classes={filteredClasses} 
            data={data} 
            dataService={dataService} 
            onViewStudentSchedule={(sid) => {
              setSelectedStudentId(sid);
              setCurrentView('student-weekly');
            }}
            onBack={() => setCurrentView('stats')}
          />}
          {currentView === 'teacher-weekly' && <TeacherWeeklyView 
             classes={filteredClasses} 
             data={data} 
             dataService={dataService} 
             onViewStudentSchedule={(sid) => {
               setSelectedStudentId(sid);
               setCurrentView('student-weekly');
             }}
             onBack={() => setCurrentView('stats')}
          />}
          {currentView === 'daily-classroom' && <DailyClassroomView 
            classes={filteredClasses} 
            data={data} 
            dataService={dataService} 
            onBack={() => setCurrentView('stats')}
          />}
          {currentView === 'daily-teacher' && <DailyTeacherView 
            classes={filteredClasses} 
            data={data} 
            dataService={dataService} 
            onBack={() => setCurrentView('stats')}
          />}
          {currentView === 'academic-calendar' && <AcademicCalendarView />}
          {currentView === 'reference-materials' && <ReferenceMaterials data={data} />}
          {currentView === 'data-manager' && <DataManager data={data} dataService={dataService} />}
        </div>
      </main>

      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} />
      )}
    </div>
  );
}
