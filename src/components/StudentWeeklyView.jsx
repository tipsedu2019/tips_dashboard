import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { User, Calendar, Search, Users, ChevronDown, Check, ArrowLeft } from 'lucide-react';
import { parseSchedule, generateTimeSlots, DAY_LABELS, CLASS_COLORS, stripClassPrefix } from '../data/sampleData';
import ClassDetailModal from './ClassDetailModal';

export default function StudentWeeklyView({ student, students = [], onSelectStudent, classes, onBack }) {
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const dropdownRef = useRef(null);

  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students.slice(0, 10);
    const query = searchQuery.toLowerCase();
    return students.filter(s => 
      s.name.toLowerCase().includes(query) || 
      (s.school && s.school.toLowerCase().includes(query)) ||
      (s.grade && s.grade.toLowerCase().includes(query))
    ).slice(0, 15);
  }, [students, searchQuery]);

  const studentClasses = useMemo(() => {
    if (!student) return [];
    const enrolledIds = student.classIds || [];
    const waitlistIds = student.waitlistClassIds || [];
    
    return classes.filter(c => enrolledIds.includes(c.id) || waitlistIds.includes(c.id))
      .map(c => ({
        ...c,
        isWaitlist: waitlistIds.includes(c.id)
      }));
  }, [student, classes]);

  const getScheduleBlocks = useCallback(() => {
    const blocks = [];
    studentClasses.forEach((cls, idx) => {
      const slots = parseSchedule(cls.schedule, cls);
      slots.forEach(sch => {
        const dayIdx = DAY_LABELS.indexOf(sch.day);
        if (dayIdx === -1) return;
        
        const timeToSlot = (timeStr) => {
          const [h, m] = timeStr.split(':').map(Number);
          return (h - 9) * 2 + (m >= 30 ? 1 : 0);
        };

        const startSlot = timeToSlot(sch.start);
        const endSlot = timeToSlot(sch.end);
        const color = CLASS_COLORS[idx % CLASS_COLORS.length];
        
        blocks.push({ 
          cls, 
          dayIdx, 
          startSlot, 
          endSlot: Math.max(endSlot, startSlot + 1), 
          color,
          isWaitlist: cls.isWaitlist
        });
      });
    });
    return blocks;
  }, [studentClasses]);

  const blocks = useMemo(() => getScheduleBlocks(), [getScheduleBlocks]);

  return (
    <div className="animate-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && (
            <button 
              className="btn-icon" 
              onClick={onBack} 
              style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <Calendar size={28} /> {student ? `${student.name} 학생 주간 스케줄` : '학생 스케줄 조회'}
            </h1>
            {student && <p style={{ margin: 0 }}>{student.grade || ''} {student.school || ''} - 수강 및 대기 수업 포함</p>}
          </div>
        </div>

        <div style={{ position: 'relative', width: 300 }} ref={dropdownRef}>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              background: 'var(--bg-surface)', 
              border: '1px solid var(--border-color)', 
              borderRadius: 12, 
              padding: '0 12px',
              height: 48,
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              cursor: 'pointer'
            }}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <Search size={18} style={{ color: 'var(--text-muted)', marginRight: 10 }} />
            <input 
              type="text" 
              placeholder="학생 이름이나 학교로 검색..." 
              style={{ 
                border: 'none', 
                background: 'transparent', 
                outline: 'none', 
                flex: 1, 
                fontSize: 14,
                color: 'var(--text-primary)',
                fontWeight: 600
              }}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!isDropdownOpen) setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onClick={(e) => e.stopPropagation()}
            />
            <ChevronDown size={18} style={{ color: 'var(--text-muted)', transform: isDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </div>

          {isDropdownOpen && (
            <div className="card-custom animate-in" style={{ 
              position: 'absolute', 
              top: '120%', 
              left: 0, 
              right: 0, 
              zIndex: 1000, 
              maxHeight: 300, 
              overflowY: 'auto',
              padding: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)'
            }}>
              {filteredStudents.length > 0 ? (
                filteredStudents.map(s => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSelectStudent(s.id);
                      setSearchQuery('');
                      setIsDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '10px 12px',
                      border: 'none',
                      background: student?.id === s.id ? 'var(--accent-light)' : 'transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.2s'
                    }}
                    className="list-item-hover"
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: student?.id === s.id ? 'var(--accent-color)' : 'var(--text-primary)' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.grade} · {s.school}</div>
                    </div>
                    {student?.id === s.id && <Check size={16} style={{ color: 'var(--accent-color)' }} />}
                  </button>
                ))
              ) : (
                <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  검색 결과가 없습니다.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!student ? (
        <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 80, height: 80, borderRadius: 40, background: 'var(--bg-surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Users size={40} style={{ opacity: 0.3 }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>조회할 학생을 선택해주세요</h2>
          <p style={{ maxWidth: 300, lineHeight: 1.6 }}>우측 상단의 검색창을 통해 학생의 주간 시간표를 간편하게 확인할 수 있습니다.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 24 }}>
          <div style={{ overflowX: 'auto' }} onMouseLeave={() => setHoveredSlot(null)}>
          <div
            className="timetable-grid"
            style={{ gridTemplateColumns: `70px repeat(${DAY_LABELS.length}, minmax(120px, 1fr))` }}
          >
            <div className="timetable-header-cell">시간</div>
            {DAY_LABELS.map((day, dayIdx) => (
              <div key={day} className={`timetable-header-cell ${hoveredSlot?.col === dayIdx ? 'hover-highlight' : ''}`}>
                {day}
              </div>
            ))}

            {timeSlots.map((time, rowIdx) => {
              const isTimeHovered = hoveredSlot && rowIdx >= hoveredSlot.startRow && rowIdx < hoveredSlot.endRow;
              return (
                <div style={{ display: 'contents' }} key={time}>
                  <div className={`timetable-time-cell ${isTimeHovered ? 'hover-highlight' : ''}`} style={{ fontWeight: time.includes(':00-') ? 600 : 400 }}>
                    {time}
                  </div>
                  {DAY_LABELS.map((day, dayIdx) => {
                    const blockStart = blocks.find(b => b.dayIdx === dayIdx && b.startSlot === rowIdx);
                    const activeBlock = blocks.find(b => b.dayIdx === dayIdx && b.startSlot <= rowIdx && b.endSlot > rowIdx);
                    
                    const isHoveredCol = hoveredSlot?.col === dayIdx;
                    const isHoveredRow = hoveredSlot && rowIdx >= hoveredSlot.startRow && rowIdx < hoveredSlot.endRow;
                    const isHovered = isHoveredCol || isHoveredRow;

                    return (
                      <div 
                        key={`${day}-${rowIdx}`} 
                        className={`timetable-cell ${isHovered ? 'hover-highlight' : ''}`}
                        onMouseEnter={() => {
                          if (activeBlock) setHoveredSlot({ col: dayIdx, startRow: activeBlock.startSlot, endRow: activeBlock.endSlot });
                          else setHoveredSlot({ col: dayIdx, startRow: rowIdx, endRow: rowIdx + 1 });
                        }}
                      >
                        {blockStart && (
                          <div
                            className="timetable-block clickable"
                            onClick={() => setSelectedClassForDetails(blockStart.cls)}
                            style={{
                              backgroundColor: blockStart.isWaitlist ? 'rgba(245, 158, 11, 0.1)' : (blockStart.color?.bg || 'var(--bg-surface)'),
                              borderLeft: `4px solid ${blockStart.isWaitlist ? '#f59e0b' : (blockStart.color?.border || 'var(--border-color)')}`,
                              color: blockStart.isWaitlist ? '#d97706' : (blockStart.color?.text || 'var(--text-primary)'),
                              height: `${(blockStart.endSlot - blockStart.startSlot) * 48 - 2}px`,
                              position: 'relative',
                              zIndex: 10
                            }}
                          >
                            <div className="block-subject">
                              [{blockStart.cls.subject}] {blockStart.isWaitlist && '(대기)'}
                            </div>
                            <div className="block-name">{stripClassPrefix(blockStart.cls.className)}</div>
                            <div className="block-info"><span className="info-label">선생님</span> {blockStart.cls.teacher}</div>
                            <div className="block-info"><span className="info-label">강의실</span> {blockStart.cls.classroom}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            })}
            </div>
          </div>
        </div>
      )}
      {selectedClassForDetails && (
        <ClassDetailModal 
          cls={selectedClassForDetails}
          data={{ students }} 
          dataService={{}} 
          onClose={() => setSelectedClassForDetails(null)}
          onNavigateToStudent={(id) => onSelectStudent(id)}
        />
      )}
    </div>
  );
}
