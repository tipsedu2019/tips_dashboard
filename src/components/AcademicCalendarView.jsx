import { useState, useMemo, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Filter, School, Tag, Info, Search, Plus, X, Trash2, Save } from 'lucide-react';
import { ALL_SCHOOLS, EVENT_TYPES, SCHOOL_COLORS } from '../data/academicData';
import { dataService } from '../services/dataService';

export default function AcademicCalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 3, 1)); 
  const [academicEvents, setAcademicEvents] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState(ALL_SCHOOLS);
  const [selectedTypes, setSelectedTypes] = useState(EVENT_TYPES);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  // 데이터 구독
  useEffect(() => {
    const unsub = dataService.subscribe(snap => {
      setAcademicEvents(snap.academicEvents || []);
    });
    return unsub;
  }, []);

  // 캘린더 날짜 계산
  const { days, monthLabel } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    
    const startDay = firstDayOfMonth.getDay(); 
    const totalDays = lastDayOfMonth.getDate();
    
    const daysArray = [];
    
    for (let i = 0; i < startDay; i++) {
        daysArray.push({ day: null, fullDate: null });
    }
    
    for (let i = 1; i <= totalDays; i++) {
        const fullDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        daysArray.push({ day: i, fullDate });
    }
    
    return { 
        days: daysArray, 
        monthLabel: `${year}년 ${month + 1}월` 
    };
  }, [currentDate]);

  // 필터링된 이벤트
  const filteredEvents = useMemo(() => {
    return academicEvents.filter(e => 
      selectedSchools.includes(e.school) && 
      selectedTypes.includes(e.type) &&
      (e.title.toLowerCase().includes(searchQuery.toLowerCase()) || e.school.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [academicEvents, selectedSchools, selectedTypes, searchQuery]);

  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

  const toggleSchool = (school) => {
    setSelectedSchools(prev => 
      prev.includes(school) ? prev.filter(s => s !== school) : [...prev, school]
    );
  };

  const toggleType = (type) => {
    setSelectedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const getDayEvents = (fullDate) => {
    if (!fullDate) return [];
    return filteredEvents.filter(e => {
        if (e.start === e.end) return e.start === fullDate;
        return fullDate >= e.start && fullDate <= e.end;
    });
  };

  const handleOpenAddModal = (dateStr) => {
    setEditingEvent({
      title: '',
      school: ALL_SCHOOLS[0],
      type: EVENT_TYPES[0],
      start: dateStr || new Date().toISOString().split('T')[0],
      end: dateStr || new Date().toISOString().split('T')[0],
      color: SCHOOL_COLORS[ALL_SCHOOLS[0]]
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (event) => {
    setEditingEvent({ ...event });
    setIsModalOpen(true);
  };

  const handleSaveEvent = () => {
    if (!editingEvent.title.trim()) {
      alert('일정 제목을 입력해주세요.');
      return;
    }
    
    // 자동 색상 지정 (학교 기준)
    const eventWithColor = {
      ...editingEvent,
      color: SCHOOL_COLORS[editingEvent.school] || '#6b7280'
    };

    if (editingEvent.id) {
      dataService.updateAcademicEvent(editingEvent.id, eventWithColor);
    } else {
      dataService.addAcademicEvent(eventWithColor);
    }
    setIsModalOpen(false);
  };

  const handleDeleteEvent = () => {
    if (editingEvent?.id && window.confirm('이 일정을 삭제하시겠습니까?')) {
      dataService.deleteAcademicEvent(editingEvent.id);
      setIsModalOpen(false);
    }
  };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarIcon size={28} /> 통합 학사 일정 캘린더
          </h1>
          <p>학교별 이벤트를 자유롭게 추가하고 편집해보세요. (구글 캘린더 스타일)</p>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenAddModal()} style={{ gap: 8 }}>
          <Plus size={18} /> 일정 추가
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>
        {/* 캘린더 메인 영역 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ 
            padding: '20px 24px', 
            borderBottom: '1px solid var(--border-color)', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            background: 'var(--bg-surface-hover)'
          }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{monthLabel}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-icon" onClick={prevMonth} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
                <ChevronLeft size={20} />
              </button>
              <button className="btn-icon" onClick={nextMonth} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          <div style={{ padding: 1 }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(7, 1fr)', 
              background: 'var(--border-color)', 
              gap: 1 
            }}>
              {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                <div key={d} style={{ 
                  padding: '12px', 
                  textAlign: 'center', 
                  background: 'var(--bg-surface-hover)', 
                  fontSize: 12, 
                  fontWeight: 700,
                  color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : 'var(--text-secondary)'
                }}>
                  {d}
                </div>
              ))}
              
              {days.map((d, i) => {
                const dayEvents = getDayEvents(d.fullDate);
                const isToday = d.fullDate === new Date().toISOString().split('T')[0];
                
                return (
                  <div key={i} 
                    onClick={() => d.fullDate && handleOpenAddModal(d.fullDate)}
                    style={{ 
                      minHeight: 120, 
                      padding: '8px', 
                      background: 'var(--bg-surface)',
                      position: 'relative',
                      border: isToday ? '2px solid var(--accent-color)' : 'none',
                      zIndex: isToday ? 1 : 0,
                      cursor: d.day ? 'pointer' : 'default'
                    }}
                    className="calendar-day-cell"
                  >
                    {d.day && (
                      <div style={{ 
                        fontSize: 13, 
                        fontWeight: 600, 
                        marginBottom: 8,
                        color: i % 7 === 0 ? '#ef4444' : i % 7 === 6 ? '#3b82f6' : 'var(--text-primary)',
                        display: 'flex',
                        justifyContent: 'space-between'
                      }}>
                        {d.day}
                        {isToday && <span style={{ fontSize: 10, background: 'var(--accent-color)', color: 'white', padding: '1px 4px', borderRadius: 4 }}>TODAY</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {dayEvents.map(event => (
                        <div 
                          key={event.id}
                          title={`${event.school}: ${event.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditModal(event);
                          }}
                          style={{ 
                            fontSize: 10, 
                            padding: '3px 6px', 
                            borderRadius: 4, 
                            background: `${SCHOOL_COLORS[event.school] || '#6b7280'}20`,
                            color: SCHOOL_COLORS[event.school] || '#6b7280',
                            borderLeft: `3px solid ${SCHOOL_COLORS[event.school] || '#6b7280'}`,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'filter 0.2s'
                          }}
                          className="calendar-event-pill"
                        >
                          <span style={{ opacity: 0.7, marginRight: 4 }}>[{event.school}]</span>
                          {event.title}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 사이드바 필터 영역 (기존과 동일) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 검색 바 */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface-hover)', padding: '8px 12px', borderRadius: 10 }}>
              <Search size={16} style={{ color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="일정 또는 학교 검색..." 
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* 학교 필터 */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <School size={18} className="text-accent" />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>학교별 필터</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ALL_SCHOOLS.map(school => (
                <label key={school} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input 
                    type="checkbox" 
                    checked={selectedSchools.includes(school)}
                    onChange={() => toggleSchool(school)}
                    style={{ width: 16, height: 16, accentColor: SCHOOL_COLORS[school] }}
                  />
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: SCHOOL_COLORS[school] }} />
                  {school}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8 }}>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, padding: '6px', fontSize: 12 }}
                onClick={() => setSelectedSchools(ALL_SCHOOLS)}
              >전체 선택</button>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, padding: '6px', fontSize: 12 }}
                onClick={() => setSelectedSchools([])}
              >전체 해제</button>
            </div>
          </div>

          {/* 일정 그룹 필터 */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Tag size={18} className="text-accent" />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>일정 종류</h3>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EVENT_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    border: '1px solid var(--border-color)',
                    background: selectedTypes.includes(type) ? 'var(--accent-color)' : 'var(--bg-surface)',
                    color: selectedTypes.includes(type) ? 'white' : 'var(--text-secondary)',
                    transition: 'all 0.2s'
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* 안내문 */}
          <div className="card" style={{ padding: 16, background: 'var(--bg-surface-hover)', border: '1px dashed var(--border-color)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Info size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  범위로 지정된 일정(예: 시험기간)은 해당 기간의 모든 날짜에 표시됩니다. 학교별 공식 학사 일정표를 기반으로 작성되었습니다.
                </p>
              </div>
          </div>
        </div>
      </div>

      {/* 일정 편집 모달 */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1400,
          backdropFilter: 'blur(4px)'
        }} onClick={() => setIsModalOpen(false)}>
          <div 
            className="card animate-in" 
            style={{ width: 440, padding: 0, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ 
              padding: '20px 24px', 
              background: 'var(--bg-surface-hover)', 
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                {editingEvent?.id ? '일정 수정' : '새 일정 추가'}
              </h3>
              <button className="btn-icon" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* 제목 입력 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>일정 제목</label>
                <input 
                  type="text" 
                  className="styled-date-input" 
                  placeholder="예: 1학기 중간고사"
                  style={{ width: '100%', height: 44, fontSize: 15 }}
                  value={editingEvent?.title || ''}
                  onChange={(e) => setEditingEvent({...editingEvent, title: e.target.value})}
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* 학교 선택 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>학교명</label>
                  <select 
                    className="styled-date-input"
                    style={{ width: '100%', height: 44 }}
                    value={editingEvent?.school || ''}
                    onChange={(e) => setEditingEvent({...editingEvent, school: e.target.value})}
                  >
                    {ALL_SCHOOLS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* 종류 선택 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>일정 종류</label>
                  <select 
                    className="styled-date-input"
                    style={{ width: '100%', height: 44 }}
                    value={editingEvent?.type || ''}
                    onChange={(e) => setEditingEvent({...editingEvent, type: e.target.value})}
                  >
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* 시작일 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>시작일</label>
                  <input 
                    type="date" 
                    className="styled-date-input"
                    style={{ width: '100%', height: 44 }}
                    value={editingEvent?.start || ''}
                    onChange={(e) => setEditingEvent({...editingEvent, start: e.target.value, end: editingEvent.end < e.target.value ? e.target.value : editingEvent.end})}
                  />
                </div>
                {/* 종료일 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>종료일</label>
                  <input 
                    type="date" 
                    className="styled-date-input"
                    style={{ width: '100%', height: 44 }}
                    value={editingEvent?.end || ''}
                    onChange={(e) => setEditingEvent({...editingEvent, end: e.target.value})}
                  />
                </div>
              </div>
            </div>

            <div style={{ 
              padding: '16px 24px', 
              background: 'var(--bg-surface-hover)', 
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: editingEvent?.id ? 'space-between' : 'flex-end',
              gap: 12
            }}>
              {editingEvent?.id && (
                <button 
                  className="btn btn-secondary" 
                  onClick={handleDeleteEvent}
                  style={{ color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)' }}
                >
                  <Trash2 size={18} /> 삭제
                </button>
              )}
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>취소</button>
                <button className="btn btn-primary" onClick={handleSaveEvent} style={{ gap: 8 }}>
                  <Save size={18} /> 저장하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
