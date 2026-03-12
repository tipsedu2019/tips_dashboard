import { useState, useMemo, useRef, useCallback } from 'react';
import { Camera, User, ArrowLeft } from 'lucide-react';
import { parseSchedule, parseScheduleMeta, generateTimeSlots, timeToSlotIndex, DAY_LABELS, CLASS_COLORS, stripClassPrefix } from '../data/sampleData';
import { useAuth } from '../contexts/AuthContext';
import ClassDetailModal from './ClassDetailModal';

export default function TeacherWeeklyView({ classes, data, dataService, onViewStudentSchedule, onBack }) {
  const { isStaff, isTeacher, user } = useAuth();
  
  const canEditBlock = useCallback((block) => {
    if (isStaff) return true;
    if (isTeacher && user && block.teacher && block.teacher.includes(user.name)) return true;
    return false;
  }, [isStaff, isTeacher, user]);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const teachers = useMemo(() => {
    const set = new Set();
    classes.forEach(c => {
      // 콤마(구분자)로만 분리 — 공백 포함 안 함 (이름에 공백 있어도 안전)
      const teacherList = (c.teacher || '').split(/[,\/]+/).map(t => t.trim()).filter(Boolean);
      teacherList.forEach(t => set.add(t));
    });
    return [...set].sort();
  }, [classes]);

  const [selectedTeacher, setSelectedTeacher] = useState('전체');
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);

  const scheduleRef = useRef(null);

  const getScheduleBlocks = useCallback((targetTeacher) => {
    const blocks = [];
    classes.forEach((cls, idx) => {
      // 콤마/슬래시로 구분된 복수 선생님 지원
      const teacherList = (cls.teacher || '').split(/[,\/]+/).map(t => t.trim()).filter(Boolean);
      const slots = parseSchedule(cls.schedule, cls);
      const meta = parseScheduleMeta(cls.schedule);
      slots.forEach(sch => {
        // 특정 선생님 오버라이드 확인
        const effectiveTeacher = sch.teacher || teacherList[0]; 
        // 만약 슬롯에 담당 선생님이 지정되어 있다면 그 분의 스케줄에만 표시, 
        // 지정 안 되어 있다면 원본 참여 명단 모두의 스케줄에 표시
        const shouldShow = sch.teacher ? (sch.teacher === targetTeacher) : teacherList.includes(targetTeacher);
        
        if (!shouldShow) return;

        const dayIdx = DAY_LABELS.indexOf(sch.day);
        if (dayIdx === -1) return;
        const startSlot = timeToSlotIndex(sch.start, 9);
        const endSlot = timeToSlotIndex(sch.end, 9);
        const color = CLASS_COLORS[idx % CLASS_COLORS.length];
        const effectiveClassroom = sch.classroom || cls.classroom;
        blocks.push({ cls, dayIdx, startSlot, endSlot: Math.max(endSlot, startSlot + 1), color, meta, effectiveClassroom, teacher: effectiveTeacher });
      });
    });
    return blocks;
  }, [classes]);

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
      link.download = `선생님_${selectedTeacher}_주간스케줄.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Image save error:', err);
      alert('이미지 저장에 실패했습니다.');
    }
  }, [selectedTeacher]);

  const renderGrid = (teacherName) => {
    const blocks = getScheduleBlocks(teacherName);
    const isAll = selectedTeacher === '전체';
    return (
      <div 
        className={`card ${isAll ? 'view-all-container' : ''}`} 
        key={teacherName} 
        style={{ padding: 24, marginBottom: isAll ? 32 : 0, breakInside: 'avoid' }}
      >
        <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <User size={20} className="text-accent" /> {teacherName} 주간 스케줄
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
            style={{ gridTemplateColumns: `70px repeat(${DAY_LABELS.length}, minmax(90px, 1fr))` }}
          >
            <div className={`timetable-header-cell`}>시간</div>
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
            )})}
          </div>
        </div>
      </div>
    );
  };

  const targetsToRender = selectedTeacher === '전체' ? teachers : [selectedTeacher];

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
            <User size={28} /> 선생님별 주간 스케줄
          </h1>
          <p>특정 선생님 또는 전체 선생님의 일주일 스케줄을 확인합니다.</p>
        </div>
        <button className="btn btn-primary" onClick={handleSaveImage}>
          <Camera size={18} /> 이미지 저장 (A4 최적화)
        </button>
      </div>

      <div className="filter-bar">
        <div className="h-segment-container">
          <button 
            className={`h-segment-btn ${selectedTeacher === '전체' ? 'active' : ''}`}
            onClick={() => setSelectedTeacher('전체')}
          >
            전체 보기 (All)
          </button>
          {teachers.map(t => (
            <button 
              key={t}
              className={`h-segment-btn ${selectedTeacher === t ? 'active' : ''}`}
              onClick={() => setSelectedTeacher(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div ref={scheduleRef} className={selectedTeacher === '전체' ? 'view-all-grid-container' : ''}>
        {targetsToRender.map(renderGrid)}
      </div>

      {selectedClassForDetails && (
        <ClassDetailModal 
          cls={selectedClassForDetails}
          data={data}
          dataService={dataService}
          onClose={() => setSelectedClassForDetails(null)}
          onNavigateToStudent={onViewStudentSchedule}
        />
      )}
    </div>
  );
}
