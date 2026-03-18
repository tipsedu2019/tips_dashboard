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

function SubjectClassCard({ cls }) {
  return (
    <div
      className="card-custom"
      style={{
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        border: `1px solid ${cls.isWaitlist ? 'rgba(245, 158, 11, 0.24)' : 'var(--border-color)'}`,
        background: cls.isWaitlist ? 'rgba(245, 158, 11, 0.05)' : 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>
            {stripClassPrefix(cls.className)}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
            {cls.schedule || '시간표 미등록'}
          </div>
        </div>
        <span
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            background: cls.isWaitlist ? 'rgba(245, 158, 11, 0.14)' : 'rgba(33, 110, 78, 0.1)',
            color: cls.isWaitlist ? '#b45309' : 'var(--accent-color)',
            fontSize: 11,
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          {cls.isWaitlist ? '대기' : cls.status}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--bg-surface-hover)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-primary)',
            fontWeight: 700,
          }}
        >
          <Users size={14} />
          {cls.teacher || '선생님 미지정'}
        </div>
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--bg-surface-hover)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-primary)',
            fontWeight: 700,
          }}
        >
          <Calendar size={14} />
          {cls.classroom || cls.room || '강의실 미지정'}
        </div>
      </div>
    </div>
  );
}

function buildTooltip({ cls, isWaitlist, teacher, classroom }) {
  return [
    stripClassPrefix(cls.className),
    isWaitlist ? '상태: 대기' : `상태: ${cls.status || '수업 진행 중'}`,
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
  embedded = false,
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

  const subjectSections = useMemo(() => (
    ['영어', '수학']
      .map((subject) => ({
        subject,
        items: studentClasses
          .filter((cls) => cls.subject === subject)
          .sort((left, right) => String(left.schedule || '').localeCompare(String(right.schedule || ''))),
      }))
      .filter((section) => section.items.length > 0)
  ), [studentClasses]);

  const examCountdowns = useMemo(
    () => getStudentExamCountdowns(
      student,
      data?.academicSchools || [],
      data?.academicExamDays || [],
      data?.academicEventExamDetails || [],
      data?.academicEvents || []
    ),
    [data?.academicEventExamDetails, data?.academicEvents, data?.academicExamDays, data?.academicSchools, student]
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
      <div style={{ position: 'relative', width: 360, maxWidth: '100%', marginBottom: embedded ? 18 : 0 }} ref={dropdownRef}>
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
                        {[candidate.grade, candidate.school].filter(Boolean).join(' · ')}
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
            조회할 학생을 선택해 주세요</h2>
          <p style={{ maxWidth: 340, lineHeight: 1.6 }}>
            상단 검색창에서 학생을 선택하면 과목별 수업 목록, 시험 일정, 주간 시간표를 함께 확인할 수 있습니다.
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
                    border: '1px solid ' + (item.examDate ? 'rgba(217, 119, 6, 0.18)' : 'var(--border-color)'),
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{item.subject} 시험</div>
                  <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900, color: item.examDate ? '#b45309' : 'var(--text-primary)' }}>
                    {item.ddayLabel}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    {item.examDate ? item.examDate + ' · ' + item.label : '등록된 시험 일정이 없습니다.'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {subjectSections.length === 0 ? (
              <div className="card" style={{ padding: 20, marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>
                  <AlertCircle size={16} /> 현재 수강 중이거나 대기 중인 수업이 없습니다
                </div>
              </div>
            ) : (
              subjectSections.map((section) => (
                <div key={section.subject} className="card" style={{ padding: 18, marginBottom: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 12,
                          background: 'var(--accent-light)',
                          color: 'var(--accent-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Clock3 size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800 }}>{section.subject}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          요일, 시간, 배정 정보를 한눈에 확인할 수 있습니다.
                        </div>
                      </div>
                    </div>
                    {section.items.some((item) => item.isWaitlist) ? (
                      <span
                        style={{
                          padding: '6px 10px',
                          borderRadius: 999,
                          background: 'rgba(245, 158, 11, 0.1)',
                          fontSize: 11,
                          fontWeight: 800,
                          color: '#b45309',
                        }}
                      >
                        대기 포함
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {section.items.map((cls) => <SubjectClassCard key={cls.id} cls={cls} />)}
                  </div>
                </div>
              ))
            )}
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
                이 학생에게 연결된 수업 시간표가 아직 없습니다.
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
