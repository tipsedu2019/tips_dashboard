import { useState, useMemo, useRef, useCallback } from 'react';
import { Camera, Users, ArrowLeft } from 'lucide-react';
import { parseSchedule, parseScheduleMeta, generateTimeSlots, timeToSlotIndex, DAY_LABELS, CLASS_COLORS, stripClassPrefix } from '../data/sampleData';
import { useAuth } from '../contexts/AuthContext';
import ClassDetailModal from './ClassDetailModal';

export default function DailyTeacherView({ classes, data, dataService, onBack }) {
  const [selectedDay, setSelectedDay] = useState('전체');
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);
  const { isStaff, isTeacher, user } = useAuth();
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);

  const canEditBlock = useCallback((block) => {
    if (isStaff) return true;
    if (isTeacher && user && block.teacher && block.teacher.includes(user.name)) return true;
    return false;
  }, [isStaff, isTeacher, user]);

  const scheduleRef = useRef(null);

  const teachers = useMemo(() => {
    const set = new Set();
    classes.forEach(c => {
      (c.teacher || '').split(/[,\/]+/).map(t => t.trim()).filter(Boolean).forEach(t => set.add(t));
    });
    return [...set].sort();
  }, [classes]);

  const getScheduleBlocks = useCallback((targetDay) => {
    const blocks = [];
    classes.forEach((cls, idx) => {
      const teacherList = (cls.teacher || '').split(/[,\/]+/).map(t => t.trim()).filter(Boolean);
      const slots = parseSchedule(cls.schedule, cls);
      const meta = parseScheduleMeta(cls.schedule);
      slots.forEach(sch => {
        if (sch.day !== targetDay) return;
        const effectiveClassroom = sch.classroom || cls.classroom;
        
        // 만약 슬롯에 특정 선생님 오버라이드가 있다면 해당 열만 표시
        if (sch.teacher) {
          const tIdx = teachers.indexOf(sch.teacher);
          if (tIdx !== -1) {
            const startSlot = timeToSlotIndex(sch.start, 9);
            const endSlot = timeToSlotIndex(sch.end, 9);
            const color = CLASS_COLORS[idx % CLASS_COLORS.length];
            blocks.push({ cls, tIdx, startSlot, endSlot: Math.max(endSlot, startSlot + 1), color, meta, effectiveClassroom, teacher: sch.teacher });
          }
        } else {
          // 오버라이드가 없으면 해당 수업의 모든 참여 강사 열에 표시
          teacherList.forEach(teacher => {
            const tIdx = teachers.indexOf(teacher);
            if (tIdx === -1) return;
            const startSlot = timeToSlotIndex(sch.start, 9);
            const endSlot = timeToSlotIndex(sch.end, 9);
            const color = CLASS_COLORS[idx % CLASS_COLORS.length];
            blocks.push({ cls, tIdx, startSlot, endSlot: Math.max(endSlot, startSlot + 1), color, meta, effectiveClassroom, teacher });
          });
        }
      });
    });
    return blocks;
  }, [classes, teachers]);

  const handleSaveImage = useCallback(async () => {
    if (!scheduleRef.current) return;
    try {
      const originalContainerStyle = scheduleRef.current.style.cssText;
      scheduleRef.current.style.width = '794px';
      scheduleRef.current.style.margin = '0 auto';
      scheduleRef.current.style.backgroundColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1c1c1e' : '#f5f5f7';
      scheduleRef.current.style.padding = '32px';

      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(scheduleRef.current, {
        scale: 2,
        windowWidth: 794,
        useCORS: true,
      });

      scheduleRef.current.style.cssText = originalContainerStyle;

      const link = document.createElement('a');
      link.download = `${selectedDay === '전체' ? '전체' : selectedDay + '요일'}_선생님스케줄.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Image save error:', err);
      alert('이미지 저장에 실패했습니다.');
    }
  }, [selectedDay]);

  const renderGrid = (dayLabel) => {
    const blocks = getScheduleBlocks(dayLabel);
    const isAll = selectedDay === '전체';
    
    if (isAll && blocks.length === 0) return null;

    return (
      <div 
        className={`card ${isAll ? 'view-all-container' : ''}`} 
        key={dayLabel} 
        style={{ padding: 24, marginBottom: isAll ? 32 : 0, breakInside: 'avoid' }}
      >
        <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={20} className="text-accent" /> {dayLabel}요일 선생님 스케줄
        </h2>
        <div 
          style={isAll ? { 
            overflow: 'hidden', 
            height: `${Math.round((timeSlots.length * 48 + 42) * 0.65)}px`
          } : { overflowX: 'auto' }} 
          className={isAll ? 'view-all-mode' : ''} 
          onMouseLeave={() => setHoveredSlot(null)}
        >
          <div
            className="timetable-grid"
            style={{ 
              gridTemplateColumns: `70px repeat(${teachers.length}, minmax(90px, 1fr))`,
            }}
          >
            <div className={`timetable-header-cell`}>시간</div>
            {teachers.map((t, idx) => (
              <div key={t} className={`timetable-header-cell ${hoveredSlot?.col === idx ? 'hover-highlight' : ''}`}>
                {t}
              </div>
            ))}

            {timeSlots.map((time, rowIdx) => {
              const isTimeHovered = hoveredSlot && rowIdx >= hoveredSlot.startRow && rowIdx < hoveredSlot.endRow;
              return (
                <div style={{ display: 'contents' }} key={time}>
                  <div className={`timetable-time-cell ${isTimeHovered ? 'hover-highlight' : ''}`} style={{ fontWeight: time.includes(':00-') ? 600 : 400 }}>
                    {time}
                  </div>
                  {teachers.map((t, tIdx) => {
                    const blockStart = blocks.find(b => b.tIdx === tIdx && b.startSlot === rowIdx);
                    const activeBlock = blocks.find(b => b.tIdx === tIdx && b.startSlot <= rowIdx && b.endSlot > rowIdx);
                    
                    const isHoveredCol = hoveredSlot?.col === tIdx;
                    const isHoveredRow = hoveredSlot && rowIdx >= hoveredSlot.startRow && rowIdx < hoveredSlot.endRow;
                    const isHovered = isHoveredCol || isHoveredRow;

                    return (
                      <div 
                        key={`${t}-${rowIdx}`} 
                        className={`timetable-cell ${isHovered ? 'hover-highlight' : ''}`}
                        onMouseEnter={() => {
                          if (activeBlock) setHoveredSlot({ col: tIdx, startRow: activeBlock.startSlot, endRow: activeBlock.endSlot });
                          else setHoveredSlot({ col: tIdx, startRow: rowIdx, endRow: rowIdx + 1 });
                        }}
                      >
                        {blockStart && (
                          <div
                            className={`timetable-block ${canEditBlock(blockStart) ? 'clickable' : ''}`}
                            style={{
                               backgroundColor: blockStart.color?.bg || 'var(--bg-surface)',
                              borderLeftColor: blockStart.color?.border || 'var(--border-color)',
                              color: blockStart.color?.text || 'var(--text-primary)',
                              height: `${(blockStart.endSlot - blockStart.startSlot) * 48 - 2}px`,
                              position: 'relative',
                              cursor: canEditBlock(blockStart) ? 'pointer' : 'default'
                            }}
                            onClick={() => {
                              if (canEditBlock(blockStart)) setSelectedClassForDetails(blockStart.cls);
                            }}
                          >
                            {blockStart.meta?.hasVariants && <span className="block-variant-dot" title="시간 변동 있음" />}
                            <div className="block-subject">[{blockStart.cls.subject}]</div>
                            <div className="block-name">{stripClassPrefix(blockStart.cls.className)}</div>
                            <div className="block-info"><span className="info-label">강의실</span> {blockStart.effectiveClassroom}</div>
                            {blockStart.cls.textbook && <div className="block-info" style={{ marginTop: 2, fontSize: 10, color: 'var(--text-muted)' }}><span className="info-label" style={{ opacity: 0.7 }}>교재</span> {blockStart.cls.textbook}</div>}
                            <div className="tooltip">
                              {blockStart.cls.textbook && `📚 교재: ${blockStart.cls.textbook}\n`}
                              {blockStart.meta?.hasVariants
                                ? `📅 시간 변동 있음\n\n${blockStart.meta.rawNote}`
                                : blockStart.cls.schedule}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const dayTabs = ['전체', ...DAY_LABELS];
  const targetsToRender = selectedDay === '전체' ? DAY_LABELS : [selectedDay];

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {onBack && (
              <button 
                className="btn-icon" 
                onClick={onBack} 
                style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <Users size={28} /> 요일별 선생님 스케줄
          </h1>
          <p>하루 단위로 학원 소속 선생님들의 일정을 한눈에 파악합니다.</p>
        </div>
        <button className="btn btn-primary" onClick={handleSaveImage}>
          <Camera size={18} /> 이미지 저장 (A4 최적화)
        </button>
      </div>

      <div className="filter-bar">
        <div className="h-segment-container">
          {dayTabs.map(day => (
            <button
              key={day}
              className={`h-segment-btn ${selectedDay === day ? 'active' : ''}`}
              onClick={() => setSelectedDay(day)}
            >
              {day === '전체' ? '전체 요일' : `${day}요일`}
            </button>
          ))}
        </div>
      </div>

      <div ref={scheduleRef} className={selectedDay === '전체' ? 'view-all-grid-container' : ''}>
        {targetsToRender.map(renderGrid)}
      </div>

      {selectedClassForDetails && (
        <ClassDetailModal 
          cls={selectedClassForDetails}
          data={data}
          dataService={dataService}
          onClose={() => setSelectedClassForDetails(null)}
        />
      )}
    </div>
  );
}
