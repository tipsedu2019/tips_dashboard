import { useMemo, useState, Fragment, useRef, useEffect } from 'react';
import { parseSchedule, timeToSlotIndex, stripClassPrefix, computeWeeklyMinutes, formatHours } from '../data/sampleData';
import { ChevronDown, ChevronRight, Search, Users, Check, AlertTriangle, User, ExternalLink, BarChart, PieChart, Layout } from 'lucide-react';
import ClassDetailModal from './ClassDetailModal';



const GROUP_OPTIONS = [
  { value: 'none', label: '없음' },
  { value: 'subject', label: '과목' },
  { value: 'grade', label: '학년' },
  { value: 'teacher', label: '선생님' },
  { value: 'classroom', label: '강의실' },
];

function buildNestedGroups(classes, groupBy1, groupBy2) {
  if (groupBy1 === 'none') return { '전체 목록': classes };

  const level1 = classes.reduce((acc, cls) => {
    const key = cls[groupBy1] || '미분류';
    if (!acc[key]) acc[key] = [];
    acc[key].push(cls);
    return acc;
  }, {});

  if (groupBy2 === 'none' || groupBy2 === groupBy1) {
    return Object.keys(level1).sort().reduce((acc, k) => { acc[k] = level1[k]; return acc; }, {});
  }

  // 2-level: for each L1 group, split by L2
  return Object.keys(level1).sort().reduce((acc, k1) => {
    const subGroups = level1[k1].reduce((sacc, cls) => {
      const key = cls[groupBy2] || '미분류';
      if (!sacc[key]) sacc[key] = [];
      sacc[key].push(cls);
      return sacc;
    }, {});
    acc[k1] = Object.keys(subGroups).sort().reduce((sacc, k2) => { sacc[k2] = subGroups[k2]; return sacc; }, {});
    return acc;
  }, {});
}

function GroupSegment({ options, value, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
      <div className="h-segment-container" style={{ flexWrap: 'nowrap' }}>
        {options.map(opt => (
          <button
            key={opt.value}
            className={`h-segment-btn ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
            style={{ padding: '6px 10px', fontSize: 12 }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClassRow({ cls, colSpan, borderTop = true }) {
  const weeklyMin = useMemo(() => computeWeeklyMinutes(cls.schedule, cls), [cls.schedule, cls]);
  const scheduleSlots = useMemo(() => parseSchedule(cls.schedule, cls), [cls.schedule, cls]);
  return (
    <tr style={{ borderTop: borderTop ? '1px solid var(--border-color)' : 'none' }}>
      <td style={{ padding: '11px 20px', fontWeight: 600, color: 'var(--accent-color)' }}>{cls.subject}</td>
      <td style={{ padding: '11px 20px' }}>{cls.grade || '-'}</td>
      <td style={{ padding: '11px 20px', fontWeight: 700 }}>{stripClassPrefix(cls.className)}</td>
      <td style={{ padding: '11px 20px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
        {scheduleSlots.map(s => `${s.day} ${s.start}-${s.end}`).join('\n')}
      </td>
      <td style={{ padding: '11px 20px' }}>{cls.teacher || '-'}</td>
      <td style={{ padding: '11px 20px' }}>{cls.classroom || '-'}</td>
      <td style={{ padding: '11px 20px' }}>
        <div 
          className="clickable"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          onClick={() => {
            // We need a way to pass setSelectedClassForDetails here. 
            // Since this is a nested function component, we'll need to move it or pass props.
            // For now, let's keep it simple and just do it in the main table render if possible or pass the function.
            if (window.__setSelectedClassForDetails) window.__setSelectedClassForDetails(cls);
          }}
        >
          <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' }}>
            <span style={{ background: 'var(--accent-light)', color: 'var(--accent-color)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
               {(cls.studentIds || []).length} / {cls.capacity || 0}
            </span>
            {(() => {
              const remain = (cls.capacity || 0) - (cls.studentIds || []).length;
              if (remain > 0 && remain <= 3) return <span style={{ fontSize: 10, background: '#3b82f6', color: 'white', padding: '0 4px', borderRadius: 4 }}>마지막 {remain}석</span>;
              if (remain <= 0 && (cls.capacity || 0) > 0) return <span style={{ fontSize: 10, background: '#f59e0b', color: 'white', padding: '0 4px', borderRadius: 4 }}>마감</span>;
              return null;
            })()}
          </div>
          {(cls.waitlistIds || []).length > 0 && (
            <div style={{ background: '#fef3c7', color: '#d97706', borderRadius: 6, padding: '1px 8px', fontSize: 10, fontWeight: 700, border: '1px solid #fcd34d', width: 'fit-content' }}>
              대기 {(cls.waitlistIds || []).length}명
            </div>
          )}
        </div>
      </td>
      <td style={{ padding: '11px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
        {cls.textbook || '-'}
      </td>
      <td style={{ padding: '11px 20px', textAlign: 'right' }}>
        {weeklyMin > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
            {Math.floor(weeklyMin/60)}h{weeklyMin%60 > 0 ? ` ${weeklyMin%60}m` : ''}/주
          </span>
        )}
      </td>
    </tr>
  );
}

function CollapsibleGroup({ groupName, children, count, indent = 0 }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <tr
        style={{ background: indent === 0 ? 'var(--bg-base)' : 'var(--bg-surface-hover)', cursor: 'pointer' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <td colSpan={8} style={{ padding: `10px ${20 + indent * 20}px`, fontWeight: 700, color: indent === 0 ? 'var(--accent-color)' : 'var(--text-primary)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {collapsed
              ? <ChevronRight size={14} />
              : <ChevronDown size={14} />
            }
            {indent === 0 ? '📂' : '📁'} {groupName}
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>({count}개)</span>
          </span>
        </td>
      </tr>
      {!collapsed && children}
    </>
  );
}

function ProportionalBar({ value, max, color, extraLabel }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{ flex: 1, background: 'var(--bg-surface-hover)', borderRadius: 8, height: 10, minWidth: 60, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 8, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', minWidth: 50 }}>
        {extraLabel}
      </div>
    </div>
  );
}

function StudentSearchSelector({ students, uniqueCount, onSelect }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return students.slice(0, 5);
    const q = searchQuery.toLowerCase();
    return students.filter(s => 
      s.name.toLowerCase().includes(q) || 
      (s.school && s.school.toLowerCase().includes(q))
    ).slice(0, 10);
  }, [students, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }} ref={containerRef}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>원생수: <span style={{ color: 'var(--accent-color)' }}>{uniqueCount}명</span></div>
      
      <div style={{ position: 'relative', marginTop: 4 }}>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            background: 'var(--bg-surface-hover)', 
            border: '1px solid var(--border-color)', 
            borderRadius: 8, 
            padding: '0 8px',
            height: 28,
            cursor: 'text'
          }}
          onClick={() => setIsOpen(true)}
        >
          <Search size={12} style={{ color: 'var(--text-muted)', marginRight: 6 }} />
          <input 
            type="text" 
            placeholder="학생 검색..."
            style={{ 
              border: 'none', 
              background: 'transparent', 
              outline: 'none', 
              width: '100%', 
              fontSize: 11, 
              color: 'var(--text-primary)',
              fontWeight: 600
            }}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
          />
          <ChevronDown size={12} style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
        </div>

        {isOpen && (
          <div className="card-custom animate-in" style={{ 
            position: 'absolute', 
            top: '100%', 
            left: 0, 
            right: 0, 
            marginTop: 4, 
            zIndex: 100, 
            maxHeight: 200, 
            overflowY: 'auto',
            padding: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minWidth: 150
          }}>
            {filtered.length > 0 ? (
              filtered.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    onSelect(s.id);
                    setIsOpen(false);
                    setSearchQuery('');
                  }}
                  className="list-item-hover"
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 8px',
                    border: 'none',
                    background: 'transparent',
                    borderRadius: 4,
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.grade} · {s.school}</div>
                </button>
              ))
            ) : (
              <div style={{ padding: 10, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>검색 결과 없음</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StatsDashboard({ classes, data, onViewStudentSchedule }) {
  const [groupBy1, setGroupBy1] = useState('grade');
  const [groupBy2, setGroupBy2] = useState('none');
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  
  // Allow ClassRow (defined outside) to trigger modal
  useEffect(() => {
    window.__setSelectedClassForDetails = setSelectedClassForDetails;
    return () => delete window.__setSelectedClassForDetails;
  }, []);

  const statsByGrade = useMemo(() => {
    const grades = ['중1', '중2', '중3', '고1', '고2', '고3'];
    const counts = {};
    grades.forEach(g => counts[g] = 0);
    
    // 현재 필터링된 수업들에 포함된 학생 ID 추출 (Set으로 중복 제거)
    const activeStudentIds = new Set();
    classes.forEach(c => {
      (c.studentIds || []).forEach(sid => activeStudentIds.add(sid));
    });

    const activeStudents = data.students.filter(s => activeStudentIds.has(s.id));
    
    activeStudents.forEach(s => {
      if (counts[s.grade] !== undefined) counts[s.grade]++;
      else if (s.grade) {
        if (!counts[s.grade]) counts[s.grade] = 0;
        counts[s.grade]++;
      }
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [classes, data.students]);

  const teacherLoad = useMemo(() => {
    const load = {};
    classes.forEach(c => {
      const teachers = (c.teacher || '').split(/[,\/]+/).map(t => t.trim()).filter(Boolean);
      teachers.forEach(t => {
        if (!load[t]) load[t] = { count: 0, classes: [] };
        load[t].count++;
        load[t].classes.push(c.className);
      });
    });
    return Object.entries(load).sort((a, b) => b[1].count - a[1].count);
  }, [classes]);

  const progressAlerts = useMemo(() => {
    if (!data?.textbooks || !data?.progressLogs) return [];
    
    // Hardcoded current simulation date to show progress changes
    const today = new Date('2026-04-10'); 
    
    return classes.map(cls => {
      if (!cls.textbookIds || cls.textbookIds.length === 0) return null;
      const tb = data.textbooks.find(t => t.id === cls.textbookIds[0]);
      if (!tb || !tb.lessons || tb.lessons.length === 0) return null;

      const logs = data.progressLogs.filter(l => l.classId === cls.id);
      let actualChapters = 0;
      if (logs.length > 0) {
        actualChapters = Math.max(...logs.map(l => l.completedLessonIds?.length || 0));
      }

      const start = new Date(cls.startDate);
      const end = new Date(cls.endDate);
      let expectedChapters = 0;
      
      if (today < start) expectedChapters = 0;
      else if (today > end) expectedChapters = tb.lessons.length;
      else {
        const totalDays = (end - start) / (1000 * 60 * 60 * 24);
        const passedDays = (today - start) / (1000 * 60 * 60 * 24);
        expectedChapters = Math.round((tb.lessons.length) * (passedDays / totalDays));
      }

      const isDelayed = actualChapters < expectedChapters; 

      return {
        cls,
        textbook: tb,
        actualChapters,
        expectedChapters,
        totalChapters: tb.lessons.length,
        isDelayed
      };
    }).filter(Boolean);
  }, [classes, data]);

  const delayedClasses = progressAlerts.filter(p => p.isDelayed);

  const stats = useMemo(() => {
    const uniqueTeachers = new Set();
    const uniqueClassrooms = new Set();

    const classroomUsage = {}; // minutes/week
    const teacherWorkload = {};

    classes.forEach(cls => {
      const slots = parseSchedule(cls.schedule, cls);
      
      const teacherList = (cls.teacher || '').split(/[,\/\n]+/).map(t => t.trim()).filter(Boolean);
      const roomList = (cls.classroom || '').split(/[,\/\n]+/).map(r => r.trim()).filter(Boolean);

      // Unique teachers/rooms for general count
      teacherList.forEach(t => uniqueTeachers.add(t));
      roomList.forEach(r => uniqueClassrooms.add(r));

      slots.forEach(slot => {
        const [sh, sm] = slot.start.split(':').map(Number);
        const [eh, em] = slot.end.split(':').map(Number);
        const slotMinutes = (eh * 60 + em) - (sh * 60 + sm);

        // Attribute classroom usage
        const targetRoom = slot.classroom || roomList[0] || '미배정';
        classroomUsage[targetRoom] = classroomUsage[targetRoom] || { minutes: 0, classes: 0, classIds: new Set() };
        classroomUsage[targetRoom].minutes += slotMinutes;
        classroomUsage[targetRoom].classIds.add(cls.id);

        // Attribute teacher workload
        if (slot.teacher) {
          teacherWorkload[slot.teacher] = teacherWorkload[slot.teacher] || { minutes: 0, classes: 0, classIds: new Set() };
          teacherWorkload[slot.teacher].minutes += slotMinutes;
          teacherWorkload[slot.teacher].classIds.add(cls.id);
        } else {
          // No override, attribute to all teachers in list (assuming they share the load or are both present)
          teacherList.forEach(t => {
            teacherWorkload[t] = teacherWorkload[t] || { minutes: 0, classes: 0, classIds: new Set() };
            teacherWorkload[t].minutes += slotMinutes;
            teacherWorkload[t].classIds.add(cls.id);
          });
        }
      });
    });

    // Post-process to get counts
    Object.values(classroomUsage).forEach(v => v.classes = v.classIds.size);
    Object.values(teacherWorkload).forEach(v => v.classes = v.classIds.size);

    const topClassrooms = Object.entries(classroomUsage)
      .sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 5);
    const topTeachers = Object.entries(teacherWorkload)
      .sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 5);

    const maxCrMin = topClassrooms[0]?.[1].minutes || 1;
    const maxTMin = topTeachers[0]?.[1].minutes || 1;

    const totalEnrollee = classes.reduce((sum, cls) => sum + (cls.studentIds?.length || 0), 0);
    const totalWaitlist = classes.reduce((sum, cls) => sum + (cls.waitlistIds?.length || 0), 0);
    const uniqueStudents = data.students?.length || 0;

    return {
      totalClasses: classes.length,
      totalTeachers: uniqueTeachers.size,
      totalClassrooms: uniqueClassrooms.size,
      totalEnrollee,
      totalWaitlist,
      uniqueStudents,
      topClassrooms, maxCrMin,
      topTeachers, maxTMin,
    };
  }, [classes]);

  const conflicts = useMemo(() => {
    if (!data.students || !classes) return [];
    
    const studentConflicts = [];
    
    data.students.forEach(student => {
      const studentClassIds = [...(student.classIds || []), ...(student.waitlistClassIds || [])];
      if (studentClassIds.length < 2) return;
      
      const enrolledClasses = classes.filter(c => studentClassIds.includes(c.id));
      const slots = [];
      
      enrolledClasses.forEach(cls => {
        const classSlots = parseSchedule(cls.schedule, cls);
        classSlots.forEach(slot => {
          slots.push({
            ...slot,
            classId: cls.id,
            className: cls.className,
            isWaitlist: (student.waitlistClassIds || []).includes(cls.id)
          });
        });
      });
      
      // Check overlaps among slots
      const overlaps = [];
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const s1 = slots[i];
          const s2 = slots[j];
          
          if (s1.day === s2.day && s1.classId !== s2.classId) {
            // Check time overlap
            const [s1StartH, s1StartM] = s1.start.split(':').map(Number);
            const [s1EndH, s1EndM] = s1.end.split(':').map(Number);
            const [s2StartH, s2StartM] = s2.start.split(':').map(Number);
            const [s2EndH, s2EndM] = s2.end.split(':').map(Number);
            
            const start1 = s1StartH * 60 + s1StartM;
            const end1 = s1EndH * 60 + s1EndM;
            const start2 = s2StartH * 60 + s2StartM;
            const end2 = s2EndH * 60 + s2EndM;
            
            if (Math.max(start1, start2) < Math.min(end1, end2)) {
              overlaps.push({ s1, s2 });
            }
          }
        }
      }
      
      if (overlaps.length > 0) {
        studentConflicts.push({
          student,
          overlaps: overlaps.filter((v, i, a) => a.findIndex(t => (t.s1.classId === v.s1.classId && t.s2.classId === v.s2.classId)) === i)
        });
      }
    });
    
    return studentConflicts;
  }, [data.students, classes]);

  const nestedGroups = useMemo(
    () => buildNestedGroups(classes, groupBy1, groupBy2),
    [classes, groupBy1, groupBy2]
  );

  const isDoubleLevel = groupBy1 !== 'none' && groupBy2 !== 'none' && groupBy2 !== groupBy1;

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>📊 TIPS DASHBOARD</h1>
          <p>학원 전체의 스케줄 현황과 주요 통계를 요약합니다.</p>
        </div>
      </div>

      {/* Conflicts Alert */}
      {conflicts.length > 0 && (
        <div className="card" style={{ marginBottom: 28, border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.02)' }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444' }}>
            <AlertTriangle size={20} />
            <h2 style={{ margin: 0, color: '#ef4444' }}>스케줄 충돌 알림 ({conflicts.length}명)</h2>
          </div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {conflicts.map(({ student, overlaps }) => (
              <div key={student.id} style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-color)' }}>
                      <User size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{student.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{student.grade} · {student.school}</div>
                    </div>
                  </div>
                  <button 
                    className="h-segment-btn" 
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={() => onViewStudentSchedule(student.id)}
                  >
                    <ExternalLink size={12} style={{ marginRight: 4 }} /> 시간표 보기
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {overlaps.map((over, idx) => (
                    <div key={idx} style={{ fontSize: 12, padding: 8, background: 'rgba(239, 68, 68, 0.05)', borderRadius: 6, borderLeft: '3px solid #ef4444' }}>
                      <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 2 }}>{over.s1.day}요일 시간 중복</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        • {stripClassPrefix(over.s1.className)} ({over.s1.start}-{over.s1.end})
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        • {stripClassPrefix(over.s2.className)} ({over.s2.start}-{over.s2.end})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 28 }}>
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <BarChart size={16} /> 학년별 수강생 분포
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {statsByGrade.map(([grade, count]) => (
              <div key={grade}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{grade}</span>
                  <span style={{ fontWeight: 700 }}>{count}명</span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-base)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${Math.min(100, (count / Math.max(1, data.students.length || 1)) * 200)}%`, 
                    background: 'var(--accent-color)',
                    borderRadius: 3
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={16} /> 선생님별 수업 담당수
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {teacherLoad.slice(0, 5).map(([name, info]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                  {name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                    <span>{name}T</span>
                    <span>{info.count}개</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>
                    {info.classes.join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--accent-light)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Layout size={24} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px 0' }}>총 수업 시간</h3>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-color)' }}>
            {Math.round(classes.reduce((acc, c) => acc + computeWeeklyMinutes(c.schedule, c), 0) / 60)}시간
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>이번 학기 기준 주간 합계 ({stats.totalClasses}개 수업)</div>
        </div>
      </div>

      {/* TOP5 Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {/* Classroom TOP5 */}
        <div className="card">
          <div className="card-header"><h2>🔥 바쁜 강의실 TOP5</h2></div>
          <div className="card-body">
            {stats.topClassrooms.map(([name, { minutes, classes: cnt }], i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--bg-surface-hover)',
                  fontSize: 11, fontWeight: 800, color: i < 3 ? '#333' : 'var(--text-muted)',
                }}>{i + 1}</div>
                <div style={{ width: 80, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ flex: 1 }}>
                  <ProportionalBar
                    value={minutes}
                    max={stats.maxCrMin}
                    color="var(--accent-color)"
                    extraLabel={`${formatHours(minutes)} · ${cnt}수업`}
                  />
                </div>
              </div>
            ))}
            {stats.topClassrooms.length === 0 && <div style={{ color: 'var(--text-muted)' }}>데이터가 없습니다.</div>}
          </div>
        </div>

        {/* Teacher TOP5 */}
        <div className="card">
          <div className="card-header"><h2>🔥 바쁜 선생님 TOP5</h2></div>
          <div className="card-body">
            {stats.topTeachers.map(([name, { minutes, classes: cnt }], i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--bg-surface-hover)',
                  fontSize: 11, fontWeight: 800, color: i < 3 ? '#333' : 'var(--text-muted)',
                }}>{i + 1}</div>
                <div style={{ width: 80, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ flex: 1 }}>
                  <ProportionalBar
                    value={minutes}
                    max={stats.maxTMin}
                    color="var(--color-3-border)"
                    extraLabel={`${formatHours(minutes)} · ${cnt}수업`}
                  />
                </div>
              </div>
            ))}
            {stats.topTeachers.length === 0 && <div style={{ color: 'var(--text-muted)' }}>데이터가 없습니다.</div>}
          </div>
        </div>
      </div>

      {/* Progress Alerts */}
      {progressAlerts.length > 0 && (
        <div className="card" style={{ marginBottom: 28, borderColor: delayedClasses.length > 0 ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-color)' }}>
          <div className="card-header" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>🚨 진도 모니터링 (시뮬레이션: 4월 초 기준)</h2>
            {delayedClasses.length > 0 ? (
              <span style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '4px 8px', borderRadius: 4, fontSize: 13, fontWeight: 700 }}>
                {delayedClasses.length}개의 수업 진도 지연
              </span>
            ) : (
              <span style={{ background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 4, fontSize: 13, fontWeight: 700 }}>전체 정상 진도</span>
            )}
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {progressAlerts.map(({ cls, textbook, isDelayed, actualChapters, expectedChapters, totalChapters }) => (
              <div key={cls.id} style={{ 
                display: 'flex', alignItems: 'center', gap: 20, 
                padding: '16px 20px', 
                background: isDelayed ? 'rgba(239, 68, 68, 0.03)' : 'var(--bg-surface)', 
                border: `1px solid ${isDelayed ? 'rgba(239, 68, 68, 0.2)' : 'var(--border-color)'}`,
                borderRadius: 12
              }}>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{stripClassPrefix(cls.className)} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>({cls.teacher})</span></div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{textbook.title}</div>
                </div>
                
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>실제 진도 ({actualChapters}/{totalChapters})</span>
                    <span style={{ color: isDelayed ? '#ef4444' : 'var(--accent-color)' }}>추천 진도: {expectedChapters}회차 이상</span>
                  </div>
                  <div style={{ height: 14, background: 'var(--bg-surface-hover)', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
                    {/* Expected bar (Ghost/Striped) */}
                    <div style={{ 
                      position: 'absolute', 
                      left: 0, 
                      top: 0, 
                      bottom: 0, 
                      width: `${(expectedChapters/totalChapters)*100}%`, 
                      background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.05), rgba(0,0,0,0.05) 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)',
                      zIndex: 1,
                      borderRight: '1px dashed rgba(0,0,0,0.2)'
                    }} />
                    {/* Actual progress */}
                    <div style={{ 
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${(actualChapters/totalChapters)*100}%`, 
                      background: isDelayed ? '#ef4444' : 'var(--accent-color)', 
                      borderRadius: 6,
                      zIndex: 2
                    }} />
                  </div>
                </div>

                <div style={{ width: 80, textAlign: 'right', fontWeight: 700, fontSize: 13, color: isDelayed ? '#ef4444' : 'var(--accent-color)' }}>
                  {isDelayed ? '지연 경고' : '정상 수강'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Class List with Nested Grouping */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ margin: 0 }}>전체 수업 목록</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <GroupSegment
              label="1차 그룹:"
              options={GROUP_OPTIONS}
              value={groupBy1}
              onChange={setGroupBy1}
            />
            {groupBy1 !== 'none' && (
              <GroupSegment
                label="2차 그룹:"
                options={GROUP_OPTIONS.filter(o => o.value !== groupBy1)}
                value={groupBy2}
                onChange={setGroupBy2}
              />
            )}
          </div>
        </div>
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>과목</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>학년</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>수업명</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>요일/시간</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>선생님</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>강의실</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>인원 (현/정/잔/대)</th>
                <th style={{ padding: '13px 20px', fontWeight: 600 }}>교재</th>
                <th style={{ padding: '13px 20px', fontWeight: 600, textAlign: 'right' }}>주간시간</th>
              </tr>
            </thead>
            <tbody>
              {isDoubleLevel
                ? Object.entries(nestedGroups).map(([g1, subGroups]) => (
                    <CollapsibleGroup key={g1} groupName={g1} count={Object.values(subGroups).flat().length} indent={0}>
                      {Object.entries(subGroups).map(([g2, rows]) => (
                        <CollapsibleGroup key={g2} groupName={g2} count={rows.length} indent={1}>
                          {rows.map((cls, i) => <ClassRow key={`${g1}-${g2}-${i}`} cls={cls} borderTop={i > 0} />)}
                        </CollapsibleGroup>
                      ))}
                    </CollapsibleGroup>
                  ))
                : groupBy1 !== 'none'
                  ? Object.entries(nestedGroups).map(([g1, rows]) => (
                      <CollapsibleGroup key={g1} groupName={g1} count={rows.length} indent={0}>
                        {rows.map((cls, i) => <ClassRow key={`${g1}-${i}`} cls={cls} borderTop={i > 0} />)}
                      </CollapsibleGroup>
                    ))
                  : classes.map((cls, i) => <ClassRow key={i} cls={cls} borderTop={i > 0} />)
              }
              {classes.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
