import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart,
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layout,
  User,
  Users,
} from 'lucide-react';
import {
  computeWeeklyMinutes,
  formatHours,
  parseSchedule,
  splitClassroomList,
  splitTeacherList,
  stripClassPrefix,
} from '../data/sampleData';
import { findExamConflictsForClasses } from '../lib/examScheduleUtils';

const SUMMARY_PANEL_STORAGE_KEY = 'tips-dashboard-summary-panels-v2';

function MetricCard({ icon, title, value, caption, collapsed = false, onToggle, children }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              background: 'var(--accent-light)',
              color: 'var(--accent-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>{title}</div>
        </div>
        {onToggle ? <SummaryToggleButton collapsed={collapsed} onClick={onToggle} /> : null}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
      {!collapsed ? (
        <>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>{caption}</div>
          {children ? <div style={{ marginTop: 14 }}>{children}</div> : null}
        </>
      ) : null}
    </div>
  );
}

function ProportionalBar({ value, max, color, extraLabel }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div
        style={{
          flex: 1,
          background: 'var(--bg-surface-hover)',
          borderRadius: 8,
          height: 10,
          minWidth: 60,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 8,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          minWidth: 72,
          textAlign: 'right',
        }}
      >
        {extraLabel}
      </div>
    </div>
  );
}

function SummaryToggleButton({ collapsed, onClick }) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      title={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
      aria-label={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </button>
  );
}

function CollapseButton({ collapsed, onClick }) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      title={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
      aria-label={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </button>
  );
}

export default function StatsDashboard({ classes, data, onViewStudentSchedule }) {
  const [collapsedPanels, setCollapsedPanels] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        classes: false,
        enrolment: false,
        teachers: false,
        classrooms: false,
        classroomUsage: false,
        teacherWorkload: false,
        conflicts: false,
        examConflicts: false,
      };
    }

    try {
      const parsed = JSON.parse(window.localStorage.getItem(SUMMARY_PANEL_STORAGE_KEY) || '{}');
      return {
        classes: Boolean(parsed.classes),
        enrolment: Boolean(parsed.enrolment),
        teachers: Boolean(parsed.teachers),
        classrooms: Boolean(parsed.classrooms),
        classroomUsage: Boolean(parsed.classroomUsage),
        teacherWorkload: Boolean(parsed.teacherWorkload),
        conflicts: Boolean(parsed.conflicts),
        examConflicts: Boolean(parsed.examConflicts),
      };
    } catch {
      return {
        classes: false,
        enrolment: false,
        teachers: false,
        classrooms: false,
        classroomUsage: false,
        teacherWorkload: false,
        conflicts: false,
        examConflicts: false,
      };
    }
  });

  const togglePanel = (key) => {
    setCollapsedPanels((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SUMMARY_PANEL_STORAGE_KEY, JSON.stringify(collapsedPanels));
  }, [collapsedPanels]);

  const stats = useMemo(() => {
    const uniqueTeachers = new Set();
    const uniqueClassrooms = new Set();
    const classroomUsage = {};
    const teacherWorkload = {};
    const registeredStudentIds = [];
    const waitlistStudentIds = [];

    classes.forEach((classItem) => {
      const teacherList = splitTeacherList(classItem.teacher || '');
      const roomList = splitClassroomList(classItem.classroom || classItem.room || '');
      const slots = parseSchedule(classItem.schedule, classItem);
      registeredStudentIds.push(...(classItem.studentIds || []));
      waitlistStudentIds.push(...(classItem.waitlistIds || []));

      teacherList.forEach((teacher) => uniqueTeachers.add(teacher));
      roomList.forEach((room) => uniqueClassrooms.add(room));

      slots.forEach((slot) => {
        const [startHour, startMinute] = String(slot.start || '00:00').split(':').map(Number);
        const [endHour, endMinute] = String(slot.end || '00:00').split(':').map(Number);
        const slotMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
        const targetRoom = slot.classroom || roomList[0] || '미배정';

        classroomUsage[targetRoom] = classroomUsage[targetRoom] || { minutes: 0, classIds: new Set() };
        classroomUsage[targetRoom].minutes += slotMinutes;
        classroomUsage[targetRoom].classIds.add(classItem.id);

        const slotTeachers = splitTeacherList(slot.teacher || classItem.teacher || '');
        slotTeachers.forEach((teacher) => {
          teacherWorkload[teacher] = teacherWorkload[teacher] || { minutes: 0, classIds: new Set() };
          teacherWorkload[teacher].minutes += slotMinutes;
          teacherWorkload[teacher].classIds.add(classItem.id);
        });
      });
    });

    const uniqueRegisteredStudentIds = [...new Set(registeredStudentIds.filter(Boolean))];
    const uniqueWaitlistStudentIds = [...new Set(waitlistStudentIds.filter(Boolean))];
    const filteredStudents = (data.students || []).filter((student) => uniqueRegisteredStudentIds.includes(student.id));
    const gradeCounts = filteredStudents.reduce((accumulator, student) => {
      const grade = String(student.grade || '미정').trim() || '미정';
      accumulator[grade] = (accumulator[grade] || 0) + 1;
      return accumulator;
    }, {});
    const gradeBreakdown = Object.entries(gradeCounts)
      .sort(([left], [right]) => left.localeCompare(right, 'ko'))
      .map(([grade, count]) => ({ grade, count }));

    const topClassrooms = Object.entries(classroomUsage)
      .map(([name, payload]) => ({
        name,
        minutes: payload.minutes,
        count: payload.classIds.size,
      }))
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 5);

    const topTeachers = Object.entries(teacherWorkload)
      .map(([name, payload]) => ({
        name,
        minutes: payload.minutes,
        count: payload.classIds.size,
      }))
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 5);

    return {
      totalClasses: classes.length,
      totalTeachers: uniqueTeachers.size,
      totalClassrooms: uniqueClassrooms.size,
      totalEnrollee: registeredStudentIds.length,
      totalWaitlist: waitlistStudentIds.length,
      uniqueStudents: uniqueRegisteredStudentIds.length,
      uniqueWaitlistStudents: uniqueWaitlistStudentIds.length,
      gradeBreakdown,
      topClassrooms,
      maxClassroomMinutes: topClassrooms[0]?.minutes || 1,
      topTeachers,
      maxTeacherMinutes: topTeachers[0]?.minutes || 1,
      totalWeeklyMinutes: classes.reduce((sum, classItem) => sum + computeWeeklyMinutes(classItem.schedule, classItem), 0),
    };
  }, [classes, data.students]);

  const conflictSummary = useMemo(() => {
    const toMinutes = (time) => {
      const [hour, minute] = String(time || '00:00').split(':').map(Number);
      return hour * 60 + minute;
    };

    const createOverlap = (left, right) => ({
      day: left.day,
      start: left.start > right.start ? left.start : right.start,
      end: left.end < right.end ? left.end : right.end,
      left,
      right,
    });

    const dedupeOverlaps = (items) => (
      items.filter((candidate, index, array) => (
        index === array.findIndex((item) => (
          item.day === candidate.day &&
          item.start === candidate.start &&
          item.end === candidate.end &&
          [item.left.classId, item.right.classId].sort().join('|') ===
            [candidate.left.classId, candidate.right.classId].sort().join('|')
        ))
      ))
    );

    const findOverlaps = (slots) => {
      const overlaps = [];

      for (let index = 0; index < slots.length; index += 1) {
        for (let compareIndex = index + 1; compareIndex < slots.length; compareIndex += 1) {
          const left = slots[index];
          const right = slots[compareIndex];

          if (left.day !== right.day || left.classId === right.classId) {
            continue;
          }

          if (Math.max(toMinutes(left.start), toMinutes(right.start)) < Math.min(toMinutes(left.end), toMinutes(right.end))) {
            overlaps.push(createOverlap(left, right));
          }
        }
      }

      return dedupeOverlaps(overlaps);
    };

    const teacherSlots = new Map();
    const classroomSlots = new Map();

    classes.forEach((classItem) => {
      parseSchedule(classItem.schedule, classItem).forEach((slot) => {
        const slotPayload = {
          ...slot,
          classId: classItem.id,
          className: classItem.className,
        };

        splitTeacherList(slot.teacher || classItem.teacher).forEach((teacher) => {
          if (!teacherSlots.has(teacher)) {
            teacherSlots.set(teacher, []);
          }
          teacherSlots.get(teacher).push(slotPayload);
        });

        splitClassroomList(slot.classroom || classItem.classroom || classItem.room).forEach((classroom) => {
          if (!classroomSlots.has(classroom)) {
            classroomSlots.set(classroom, []);
          }
          classroomSlots.get(classroom).push(slotPayload);
        });
      });
    });

    const student = (data.students || [])
      .map((studentItem) => {
        const studentClassIds = [...(studentItem.classIds || []), ...(studentItem.waitlistClassIds || [])];
        if (studentClassIds.length < 2) {
          return null;
        }

        const studentSlots = classes
          .filter((classItem) => studentClassIds.includes(classItem.id))
          .flatMap((classItem) => parseSchedule(classItem.schedule, classItem).map((slot) => ({
            ...slot,
            classId: classItem.id,
            className: classItem.className,
          })));

        const overlaps = findOverlaps(studentSlots);
        if (overlaps.length === 0) {
          return null;
        }

        return {
          id: studentItem.id,
          type: 'student',
          label: studentItem.name,
          meta: [studentItem.grade, studentItem.school].filter(Boolean).join(' · '),
          overlaps,
        };
      })
      .filter(Boolean);

    const teacher = [...teacherSlots.entries()]
      .map(([name, slots]) => {
        const overlaps = findOverlaps(slots);
        if (overlaps.length === 0) {
          return null;
        }

        return {
          id: `teacher:${name}`,
          type: 'teacher',
          label: name,
          meta: '선생님 시간 충돌',
          overlaps,
        };
      })
      .filter(Boolean);

    const classroom = [...classroomSlots.entries()]
      .map(([name, slots]) => {
        const overlaps = findOverlaps(slots);
        if (overlaps.length === 0) {
          return null;
        }

        return {
          id: `classroom:${name}`,
          type: 'classroom',
          label: name,
          meta: '강의실 시간 충돌',
          overlaps,
        };
      })
      .filter(Boolean);

    return {
      student,
      teacher,
      classroom,
      total: student.length + teacher.length + classroom.length,
    };
  }, [classes, data.students]);

  const examConflictSummary = useMemo(
    () => findExamConflictsForClasses(
      classes,
      data.students || [],
      data.academicSchools || [],
      data.academicExamDays || [],
      data.academicEventExamDetails || [],
      data.academicEvents || []
    ),
    [classes, data.academicEventExamDetails, data.academicEvents, data.academicExamDays, data.academicSchools, data.students]
  );

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>개요</h1>
          <p>주요 운영 지표와 충돌 알림을 빠르게 확인하고, 필요한 시간표 화면으로 바로 넘어갈 수 있습니다.</p>
        </div>
      </div>

      {conflictSummary.total > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 28,
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: 'rgba(239, 68, 68, 0.02)',
          }}
        >
          <div
            className="card-header"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, color: '#ef4444' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <AlertTriangle size={20} />
              <h2 style={{ margin: 0, color: '#ef4444' }}>충돌 알림</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: 12, fontWeight: 700 }}>
                  학생 {conflictSummary.student.length}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(245, 158, 11, 0.12)', color: '#b45309', fontSize: 12, fontWeight: 700 }}>
                  선생님 {conflictSummary.teacher.length}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8', fontSize: 12, fontWeight: 700 }}>
                  강의실 {conflictSummary.classroom.length}
                </span>
              </div>
            </div>
            <CollapseButton collapsed={collapsedPanels.conflicts} onClick={() => togglePanel('conflicts')} />
          </div>
          {!collapsedPanels.conflicts && (
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[
                { key: 'student', title: '학생 시간 충돌', items: conflictSummary.student, accent: '#ef4444' },
                { key: 'teacher', title: '선생님 시간 충돌', items: conflictSummary.teacher, accent: '#b45309' },
                { key: 'classroom', title: '강의실 시간 충돌', items: conflictSummary.classroom, accent: '#1d4ed8' },
              ]
                .filter((section) => section.items.length > 0)
                .map((section) => (
                  <section key={section.key} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: section.accent }}>{section.title}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                      {section.items.map((entry) => (
                        <div
                          key={entry.id}
                          style={{
                            padding: 16,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.label}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.meta}</div>
                            </div>
                            {entry.type === 'student' && (
                              <button
                                className="h-segment-btn"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                onClick={() => onViewStudentSchedule(entry.id)}
                              >
                                <ExternalLink size={12} style={{ marginRight: 4 }} />
                                시간표 보기
                              </button>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {entry.overlaps.map((overlap, index) => (
                              <div
                                key={`${entry.id}-${index}`}
                                style={{
                                  fontSize: 12,
                                  padding: 8,
                                  background: 'rgba(239, 68, 68, 0.05)',
                                  borderRadius: 6,
                                  borderLeft: `3px solid ${section.accent}`,
                                }}
                              >
                                <div style={{ fontWeight: 700, color: section.accent, marginBottom: 4 }}>
                                  {overlap.day} {overlap.start}-{overlap.end}
                                </div>
                                <div style={{ color: 'var(--text-secondary)' }}>
                                  1. {stripClassPrefix(overlap.left.className)} ({overlap.left.start}-{overlap.left.end})
                                </div>
                                <div style={{ color: 'var(--text-secondary)' }}>
                                  2. {stripClassPrefix(overlap.right.className)} ({overlap.right.start}-{overlap.right.end})
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          )}
        </div>
      )}

      {examConflictSummary.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 28,
            border: '1px solid rgba(217, 119, 6, 0.3)',
            background: 'rgba(245, 158, 11, 0.04)',
          }}
        >
          <div
            className="card-header"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, color: '#b45309' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <AlertTriangle size={20} />
              <h2 style={{ margin: 0, color: '#b45309' }}>시험/수업 충돌 알림</h2>
              <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(245, 158, 11, 0.12)', fontSize: 12, fontWeight: 700 }}>
                {examConflictSummary.length}개 수업
              </span>
            </div>
            <CollapseButton collapsed={collapsedPanels.examConflicts} onClick={() => togglePanel('examConflicts')} />
          </div>
          {!collapsedPanels.examConflicts && (
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {examConflictSummary.map((entry) => (
                <div
                  key={entry.classId}
                  style={{
                    padding: 16,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 14,
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>{stripClassPrefix(entry.className)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>{entry.subject}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {entry.conflicts.map((conflict) => (
                      <div
                        key={`${entry.classId}-${conflict.subject}-${conflict.examDate}`}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          background: 'rgba(245, 158, 11, 0.08)',
                          borderLeft: '3px solid #d97706',
                          fontSize: 12,
                          lineHeight: 1.6,
                        }}
                      >
                        <div style={{ fontWeight: 800, color: '#b45309' }}>
                          {conflict.examDate} · {conflict.label}
                        </div>
                        <div style={{ color: 'var(--text-secondary)' }}>{conflict.schoolName} · {conflict.grade}</div>
                        <div style={{ color: 'var(--text-primary)' }}>대상 학생: {conflict.students.join(', ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 20,
          marginBottom: 28,
        }}
      >
        <MetricCard
          icon={<Layout size={22} />}
          title={"\uC6B4\uC601 \uC218\uC5C5"}
          value={<span data-testid="stats-total-classes">{`${stats.totalClasses}개`}</span>}
          caption={`주간 총 ${formatHours(stats.totalWeeklyMinutes)} 운영 중`}
          collapsed={collapsedPanels.classes}
          onToggle={() => togglePanel('classes')}
        />
        <MetricCard
          icon={<Users size={22} />}
          title={"\uB4F1\uB85D \uC778\uC6D0"}
          value={`${stats.totalEnrollee}명`}
          caption={`학생 기준 ${stats.uniqueStudents}명 · 수강 기준 ${stats.totalEnrollee}건`}
          collapsed={collapsedPanels.enrolment}
          onToggle={() => togglePanel('enrolment')}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>{`대기 ${stats.totalWaitlist}명`}</span>
              <span>{`대기 학생 ${stats.uniqueWaitlistStudents}명`}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {stats.gradeBreakdown.length > 0 ? stats.gradeBreakdown.map((entry) => (
                <span
                  key={entry.grade}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: 'var(--bg-surface-hover)',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {`${entry.grade} ${entry.count}명`}
                </span>
              )) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{"\uD604\uC7AC \uD544\uD130 \uAE30\uC900 \uB4F1\uB85D \uD559\uC0DD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</span>
              )}
            </div>
          </div>
        </MetricCard>
        <MetricCard
          icon={<User size={22} />}
          title={"\uC120\uC0DD\uB2D8"}
          value={`${stats.totalTeachers}명`}
          caption={"현재 필터 기준 수업 담당 인원"}
          collapsed={collapsedPanels.teachers}
          onToggle={() => togglePanel('teachers')}
        />
        <MetricCard
          icon={<Building2 size={22} />}
          title={"\uAC15\uC758\uC2E4"}
          value={`${stats.totalClassrooms}실`}
          caption={"현재 필터 기준 사용 중인 강의실"}
          collapsed={collapsedPanels.classrooms}
          onToggle={() => togglePanel('classrooms')}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 20,
          marginBottom: 28,
        }}
      >
        <div className="card" style={{ padding: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: collapsedPanels.classroomUsage ? 0 : 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BarChart size={18} className="text-accent" />
              <h2 style={{ margin: 0, fontSize: 16 }}>강의실 사용량 TOP 5</h2>
            </div>
            <CollapseButton collapsed={collapsedPanels.classroomUsage} onClick={() => togglePanel('classroomUsage')} />
          </div>
          {!collapsedPanels.classroomUsage && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {stats.topClassrooms.length > 0 ? stats.topClassrooms.map((entry, index) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, fontSize: 12, fontWeight: 800, color: 'var(--text-muted)' }}>
                    {index + 1}
                  </div>
                  <div style={{ minWidth: 84, fontWeight: 700 }}>{entry.name}</div>
                  <ProportionalBar
                    value={entry.minutes}
                    max={stats.maxClassroomMinutes}
                    color="var(--accent-color)"
                    extraLabel={`${formatHours(entry.minutes)} · ${entry.count}개`}
                  />
                </div>
              )) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>표시할 데이터가 없습니다.</div>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: collapsedPanels.teacherWorkload ? 0 : 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Users size={18} className="text-accent" />
              <h2 style={{ margin: 0, fontSize: 16 }}>선생님 담당량 TOP 5</h2>
            </div>
            <CollapseButton collapsed={collapsedPanels.teacherWorkload} onClick={() => togglePanel('teacherWorkload')} />
          </div>
          {!collapsedPanels.teacherWorkload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {stats.topTeachers.length > 0 ? stats.topTeachers.map((entry, index) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, fontSize: 12, fontWeight: 800, color: 'var(--text-muted)' }}>
                    {index + 1}
                  </div>
                  <div style={{ minWidth: 84, fontWeight: 700 }}>{entry.name}</div>
                  <ProportionalBar
                    value={entry.minutes}
                    max={stats.maxTeacherMinutes}
                    color="#b45309"
                    extraLabel={`${formatHours(entry.minutes)} · ${entry.count}개`}
                  />
                </div>
              )) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>표시할 데이터가 없습니다.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

