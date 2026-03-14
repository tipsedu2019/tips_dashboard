import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Search,
  Users,
  ChevronDown,
  Check,
  ArrowLeft,
  Clock3,
  AlertCircle,
} from 'lucide-react';
import {
  parseSchedule,
  generateTimeSlots,
  DAY_LABELS,
  CLASS_COLORS,
  stripClassPrefix,
  timeToSlotIndex,
} from '../data/sampleData';
import ClassDetailModal from './ClassDetailModal';
import TimetableGrid from './ui/TimetableGrid';
import { getStudentExamCountdowns } from '../lib/examScheduleUtils';

function buildTooltip({ cls, isWaitlist, teacher, classroom }) {
  return [
    stripClassPrefix(cls.className),
    isWaitlist ? '상태: 대기' : '상태: 등록',
    teacher ? `선생님: ${teacher}` : null,
    classroom ? `강의실: ${classroom}` : null,
    '',
    cls.schedule,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export default function StudentWeeklyView({
  student,
  students = [],
  onSelectStudent,
  classes,
  data,
  dataService,
  onBack,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const dropdownRef = useRef(null);
  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);

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

    return students
      .filter((candidate) =>
        candidate.name.toLowerCase().includes(query) ||
        (candidate.school && candidate.school.toLowerCase().includes(query)) ||
        (candidate.grade && candidate.grade.toLowerCase().includes(query))
      )
      .slice(0, 15);
  }, [searchQuery, students]);

  const studentClasses = useMemo(() => {
    if (!student) return [];

    const enrolledIds = student.classIds || [];
    const waitlistIds = student.waitlistClassIds || [];

    return classes
      .filter((cls) => {
        const enrolled = enrolledIds.includes(cls.id) || (cls.studentIds || []).includes(student.id);
        const waitlisted = waitlistIds.includes(cls.id) || (cls.waitlistIds || []).includes(student.id);
        return enrolled || waitlisted;
      })
      .map((cls) => ({
        ...cls,
        isWaitlist: waitlistIds.includes(cls.id) || (cls.waitlistIds || []).includes(student.id),
      }));
  }, [classes, student]);

  const stats = useMemo(() => {
    const enrolled = studentClasses.filter((cls) => !cls.isWaitlist).length;
    const waitlist = studentClasses.filter((cls) => cls.isWaitlist).length;
    const weeklyMinutes = studentClasses.reduce((sum, cls) => {
      return (
        sum +
        parseSchedule(cls.schedule, cls).reduce((slotSum, slot) => {
          const startSlot = timeToSlotIndex(slot.start, 9);
          const endSlot = Math.max(timeToSlotIndex(slot.end, 9), startSlot + 1);
          return slotSum + (endSlot - startSlot) * 30;
        }, 0)
      );
    }, 0);

    return {
      enrolled,
      waitlist,
      weeklyHours: (weeklyMinutes / 60).toFixed(1),
    };
  }, [studentClasses]);

  const examCountdowns = useMemo(
    () => getStudentExamCountdowns(student, data?.academicSchools || [], data?.academicExamDays || []),
    [data?.academicExamDays, data?.academicSchools, student]
  );

  const blocks = useMemo(
    () =>
      studentClasses.flatMap((cls, index) =>
        parseSchedule(cls.schedule, cls).flatMap((slot) => {
          const dayIndex = DAY_LABELS.indexOf(slot.day);
          if (dayIndex === -1) {
            return [];
          }

          const startSlot = timeToSlotIndex(slot.start, 9);
          const endSlot = Math.max(timeToSlotIndex(slot.end, 9), startSlot + 1);
          const teacher = slot.teacher || cls.teacher || '-';
          const classroom = slot.classroom || cls.classroom || cls.room || '-';
          const palette = cls.isWaitlist
            ? { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', text: '#b45309' }
            : CLASS_COLORS[index % CLASS_COLORS.length];

          return [
            {
              key: `${cls.id}-${slot.day}-${slot.start}-${slot.end}-${classroom}`,
              columnIndex: dayIndex,
              startSlot,
              endSlot,
              backgroundColor: palette.bg,
              borderColor: palette.border,
              textColor: palette.text,
              clickable: true,
              onClick: () => setSelectedClassForDetails(cls),
              header: cls.subject ? `[${cls.subject}]${cls.isWaitlist ? ' 대기' : ''}` : cls.isWaitlist ? '대기' : '',
              title: stripClassPrefix(cls.className),
              detailLines: [
                { label: '선생님', value: teacher },
                { label: '강의실', value: classroom, subtle: true },
              ],
              tooltip: buildTooltip({ cls, isWaitlist: cls.isWaitlist, teacher, classroom }),
            },
          ];
        })
      ),
    [studentClasses]
  );

  return (
    <div className="animate-in">
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && (
            <button
              className="btn-icon"
              onClick={onBack}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
              }}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <Calendar size={28} /> {student ? `${student.name} 학생 주간 시간표` : '학생 시간표 조회'}
            </h1>
            {student && (
              <p style={{ margin: 0 }}>
                {student.grade || ''} {student.school || ''} 기준으로 등록반과 대기반을 함께 보여줍니다.
              </p>
            )}
          </div>
        </div>

        <div style={{ position: 'relative', width: 320, maxWidth: '100%' }} ref={dropdownRef}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 14,
              padding: '0 12px',
              height: 48,
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              cursor: 'pointer',
            }}
            onClick={() => setIsDropdownOpen((open) => !open)}
          >
            <Search size={18} style={{ color: 'var(--text-muted)', marginRight: 10 }} />
            <input
              type="text"
              placeholder="학생 이름, 학교, 학년 검색"
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                flex: 1,
                fontSize: 14,
                color: 'var(--text-primary)',
                fontWeight: 600,
              }}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                if (!isDropdownOpen) setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onClick={(event) => event.stopPropagation()}
            />
            <ChevronDown
              size={18}
              style={{
                color: 'var(--text-muted)',
                transform: isDropdownOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </div>

          {isDropdownOpen && (
            <div
              className="card-custom animate-in"
              style={{
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
                background: 'var(--bg-surface)',
              }}
            >
              {filteredStudents.length > 0 ? (
                filteredStudents.map((candidate) => (
                  <button
                    key={candidate.id}
                    onClick={() => {
                      onSelectStudent(candidate.id);
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
                      background: student?.id === candidate.id ? 'var(--accent-light)' : 'transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    className="list-item-hover"
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 13,
                          color: student?.id === candidate.id ? 'var(--accent-color)' : 'var(--text-primary)',
                        }}
                      >
                        {candidate.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {candidate.grade} · {candidate.school}
                      </div>
                    </div>
                    {student?.id === candidate.id && <Check size={16} style={{ color: 'var(--accent-color)' }} />}
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
        <div
          className="card"
          style={{
            padding: 60,
            textAlign: 'center',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              background: 'var(--bg-surface-hover)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <Users size={40} style={{ opacity: 0.3 }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            조회할 학생을 선택해 주세요
          </h2>
          <p style={{ maxWidth: 340, lineHeight: 1.6 }}>
            상단 검색창에서 학생을 선택하면 주간 시간표와 대기 수업까지 함께 확인할 수 있습니다.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {student && examCountdowns.some((item) => item.examDate) && (
            <div
              className="card"
              style={{
                padding: 18,
                marginBottom: 0,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {examCountdowns.map((item) => (
                <div
                  key={item.subject}
                  style={{
                    minWidth: 180,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: item.examDate ? 'rgba(217, 119, 6, 0.08)' : 'var(--bg-surface-hover)',
                    border: `1px solid ${item.examDate ? 'rgba(217, 119, 6, 0.18)' : 'var(--border-color)'}`,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{item.subject} 시험</div>
                  <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900, color: item.examDate ? '#b45309' : 'var(--text-primary)' }}>
                    {item.ddayLabel}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    {item.examDate ? `${item.examDate} · ${item.label}` : '등록된 일정이 없습니다.'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
            }}
          >
            <div className="card" style={{ padding: 20, marginBottom: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <Users size={16} /> 등록 수업
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 10 }}>{stats.enrolled}</div>
            </div>

            <div className="card" style={{ padding: 20, marginBottom: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: '#d97706',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <AlertCircle size={16} /> 대기 수업
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 10, color: '#d97706' }}>
                {stats.waitlist}
              </div>
            </div>

            <div className="card" style={{ padding: 20, marginBottom: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <Clock3 size={16} /> 주간 수업 시간
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 10 }}>{stats.weeklyHours}h</div>
            </div>
          </div>

          <div className="card" style={{ padding: 24, marginBottom: 0 }}>
            {blocks.length === 0 ? (
              <div
                style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-surface-hover)',
                  borderRadius: 16,
                }}
              >
                이 학생에게 연결된 수업 시간이 없습니다.
              </div>
            ) : (
              <TimetableGrid
                columns={DAY_LABELS}
                timeSlots={timeSlots}
                blocks={blocks}
                minColumnWidth={120}
                timeLabel="시간"
              />
            )}
          </div>
        </div>
      )}

      {selectedClassForDetails && (
        <ClassDetailModal
          cls={selectedClassForDetails}
          data={{
            students: data?.students || students,
            textbooks: data?.textbooks || [],
            progressLogs: data?.progressLogs || [],
          }}
          dataService={dataService || {}}
          onClose={() => setSelectedClassForDetails(null)}
          onNavigateToStudent={(id) => onSelectStudent(id)}
        />
      )}
    </div>
  );
}
