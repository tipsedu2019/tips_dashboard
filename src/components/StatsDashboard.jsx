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
import { calculateSchedulePlan, normalizeSchedulePlan } from '../lib/classSchedulePlanner';
import { findExamConflictsForClasses } from '../lib/examScheduleUtils';
import {
  DashboardDataSurface,
  DashboardMetricCard,
  DashboardSectionIntro,
  DashboardSummaryStrip,
  DashboardTopRail,
} from './ui/dashboard';
import { Badge, TextButton } from './ui/tds';

const SUMMARY_PANEL_STORAGE_KEY = 'tips-dashboard-summary-panels-v2';

function ProportionalBar({ value, max, color, extraLabel }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div className="stats-bar-row">
      <div className="stats-bar-track">
        <div
          className="stats-bar-fill"
          style={{
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
      <div className="stats-bar-label">
        {extraLabel}
      </div>
    </div>
  );
}

function SummaryToggleButton({ collapsed, onClick }) {
  return (
    <button
      type="button"
      className="btn-ghost stats-icon-button"
      onClick={onClick}
      title={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
      aria-label={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
    >
      {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </button>
  );
}

function CollapseButton({ collapsed, onClick }) {
  return (
    <button
      type="button"
      className="btn-ghost stats-icon-button"
      onClick={onClick}
      title={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
      aria-label={collapsed ? '\uBCF5\uAD6C' : '\uCD5C\uC18C\uD654'}
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

  const planningStats = useMemo(
    () =>
      classes.reduce(
        (accumulator, classItem) => {
          const normalizedPlan = normalizeSchedulePlan(
            classItem.schedulePlan || classItem.schedule_plan || null,
            {
              className: classItem.className || classItem.name || '',
              subject: classItem.subject || '',
              schedule: classItem.schedule || '',
              startDate: classItem.startDate || classItem.start_date || '',
              endDate: classItem.endDate || classItem.end_date || '',
              textbookIds: classItem.textbookIds || [],
              textbooks: data.textbooks || [],
            },
          );
          const calculatedPlan = calculateSchedulePlan(normalizedPlan);
          const activeSessions = (calculatedPlan.sessions || []).filter(
            (session) => session.scheduleState !== 'exception' && session.scheduleState !== 'tbd',
          );
          const totalSessions = activeSessions.length;
          const completedSessions = activeSessions.filter(
            (session) => session.progressStatus === 'done',
          ).length;
          const updatedSessions = activeSessions.filter(
            (session) => session.progressStatus !== 'pending',
          ).length;

          if (totalSessions > 0) {
            accumulator.managedClasses += 1;
          }

          accumulator.totalSessions += totalSessions;
          accumulator.completedSessions += completedSessions;
          accumulator.pendingSessions += Math.max(totalSessions - updatedSessions, 0);
          return accumulator;
        },
        {
          managedClasses: 0,
          totalSessions: 0,
          completedSessions: 0,
          pendingSessions: 0,
        },
      ),
    [classes, data.textbooks],
  );

  const summaryItems = useMemo(
    () => [
      { label: '운영 수업', value: `${stats.totalClasses}개` },
      { label: '등록 인원', value: `${stats.totalEnrollee}명` },
      { label: '주간 운영', value: formatHours(stats.totalWeeklyMinutes) },
      { label: '계획 관리 반', value: `${planningStats.managedClasses}개` },
      { label: '계획 총 회차', value: `${planningStats.totalSessions}회` },
      { label: '계획 완료', value: `${planningStats.completedSessions}회` },
      { label: '계획 대기', value: `${planningStats.pendingSessions}회` },
    ],
    [
      planningStats.completedSessions,
      planningStats.managedClasses,
      planningStats.pendingSessions,
      planningStats.totalSessions,
      stats.totalClasses,
      stats.totalEnrollee,
      stats.totalWeeklyMinutes,
    ],
  );

  return (
    <div
      className="animate-in stats-dashboard app-shell-section stats-dashboard-shell"
      data-testid="stats-dashboard-shell"
    >
      <DashboardTopRail
        className="stats-dashboard-top-rail"
        testId="stats-dashboard-top-rail"
      >
        <DashboardSummaryStrip items={summaryItems} />
      </DashboardTopRail>

      <DashboardSectionIntro
        eyebrow="운영 개요"
        title="개요"
        description="주요 운영 지표와 충돌 알림을 빠르게 확인하고, 필요한 시간표 화면으로 바로 넘어갈 수 있습니다."
      />

      {conflictSummary.total > 0 && (
        <DashboardDataSurface
          className="stats-alert-card is-danger"
          testId="stats-conflict-surface"
          header={(
            <div className="stats-alert-card-heading">
              <AlertTriangle size={20} />
              <h2>충돌 알림</h2>
            </div>
          )}
          summary={(
            <div className="stats-alert-badge-row">
              <Badge type="red" badgeStyle="weak">학생 {conflictSummary.student.length}</Badge>
              <Badge type="amber" badgeStyle="weak">선생님 {conflictSummary.teacher.length}</Badge>
              <Badge type="blue" badgeStyle="weak">강의실 {conflictSummary.classroom.length}</Badge>
            </div>
          )}
          actions={(
            <CollapseButton
              collapsed={collapsedPanels.conflicts}
              onClick={() => togglePanel('conflicts')}
            />
          )}
        >
          {!collapsedPanels.conflicts ? (
            <div className="stats-alert-card-body">
              {[
                { key: 'student', title: '학생 시간 충돌', items: conflictSummary.student, accent: '#ef4444' },
                { key: 'teacher', title: '선생님 시간 충돌', items: conflictSummary.teacher, accent: '#b45309' },
                { key: 'classroom', title: '강의실 시간 충돌', items: conflictSummary.classroom, accent: '#1d4ed8' },
              ]
                .filter((section) => section.items.length > 0)
                .map((section) => (
                  <section key={section.key} className="stats-alert-section">
                    <h3 style={{ color: section.accent }}>{section.title}</h3>
                    <div className="stats-alert-entry-grid">
                      {section.items.map((entry) => (
                        <div key={entry.id} className="stats-alert-entry">
                          <div className="stats-alert-entry-head">
                            <div className="stats-alert-entry-copy">
                              <div className="stats-alert-entry-title">{entry.label}</div>
                              <div className="stats-alert-entry-meta">{entry.meta}</div>
                            </div>
                            {entry.type === 'student' && (
                              <TextButton
                                className="stats-inline-action"
                                onPress={() => onViewStudentSchedule(entry.id)}
                              >
                                <span className="tds-inline">
                                  <ExternalLink size={12} />
                                  시간표 보기
                                </span>
                              </TextButton>
                            )}
                          </div>
                          <div className="stats-alert-overlap-list">
                            {entry.overlaps.map((overlap, index) => (
                              <div
                                key={`${entry.id}-${index}`}
                                className="stats-alert-overlap-card"
                                style={{ '--stats-accent': section.accent }}
                              >
                                <div className="stats-alert-overlap-time" style={{ color: section.accent }}>
                                  {overlap.day} {overlap.start}-{overlap.end}
                                </div>
                                <div className="stats-alert-overlap-line">
                                  1. {stripClassPrefix(overlap.left.className)} ({overlap.left.start}-{overlap.left.end})
                                </div>
                                <div className="stats-alert-overlap-line">
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
          ) : null}
        </DashboardDataSurface>
      )}

      {examConflictSummary.length > 0 && (
        <DashboardDataSurface
          className="stats-alert-card is-warning"
          testId="stats-exam-conflict-surface"
          header={(
            <div className="stats-alert-card-heading">
              <AlertTriangle size={20} />
              <h2>시험/수업 충돌 알림</h2>
            </div>
          )}
          summary={<Badge type="amber" badgeStyle="weak">{examConflictSummary.length}개 수업</Badge>}
          actions={(
            <CollapseButton
              collapsed={collapsedPanels.examConflicts}
              onClick={() => togglePanel('examConflicts')}
            />
          )}
        >
          {!collapsedPanels.examConflicts ? (
            <div className="stats-alert-entry-grid">
              {examConflictSummary.map((entry) => (
                <div key={entry.classId} className="stats-alert-entry">
                  <div className="stats-alert-entry-title">{stripClassPrefix(entry.className)}</div>
                  <div className="stats-alert-entry-meta">{entry.subject}</div>
                  <div className="stats-alert-overlap-list">
                    {entry.conflicts.map((conflict) => (
                      <div
                        key={`${entry.classId}-${conflict.subject}-${conflict.examDate}`}
                        className="stats-alert-overlap-card is-warning"
                      >
                        <div className="stats-alert-overlap-time is-warning">
                          {conflict.examDate} · {conflict.label}
                        </div>
                        <div className="stats-alert-overlap-line">{conflict.schoolName} · {conflict.grade}</div>
                        <div className="stats-alert-overlap-line is-strong">대상 학생: {conflict.students.join(', ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </DashboardDataSurface>
      )}

      <div className="stats-kpi-grid">
        <DashboardMetricCard
          icon={<Layout size={22} />}
          label={"\uC6B4\uC601 \uC218\uC5C5"}
          value={<span data-testid="stats-total-classes">{`${stats.totalClasses}개`}</span>}
          caption={collapsedPanels.classes ? '' : `주간 총 ${formatHours(stats.totalWeeklyMinutes)} 운영 중`}
          actions={<SummaryToggleButton collapsed={collapsedPanels.classes} onClick={() => togglePanel('classes')} />}
        />
        <DashboardMetricCard
          icon={<Users size={22} />}
          label={"\uB4F1\uB85D \uC778\uC6D0"}
          value={`${stats.totalEnrollee}명`}
          caption={
            collapsedPanels.enrolment
              ? ''
              : `학생 기준 ${stats.uniqueStudents}명 · 수강 기준 ${stats.totalEnrollee}건`
          }
          actions={<SummaryToggleButton collapsed={collapsedPanels.enrolment} onClick={() => togglePanel('enrolment')} />}
        >
          {!collapsedPanels.enrolment ? (
            <div className="stats-metric-chip-stack">
              <div className="stats-metric-meta-row">
                <span>{`대기 ${stats.totalWaitlist}명`}</span>
                <span>{`대기 학생 ${stats.uniqueWaitlistStudents}명`}</span>
              </div>
              <div className="stats-metric-chip-row">
                {stats.gradeBreakdown.length > 0 ? stats.gradeBreakdown.map((entry) => (
                  <span key={entry.grade} className="stats-metric-chip">
                    {`${entry.grade} ${entry.count}명`}
                  </span>
                )) : (
                  <span className="stats-metric-empty">{"\uD604\uC7AC \uD544\uD130 \uAE30\uC900 \uB4F1\uB85D \uD559\uC0DD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</span>
                )}
              </div>
            </div>
          ) : null}
        </DashboardMetricCard>
        <DashboardMetricCard
          icon={<User size={22} />}
          label={"\uC120\uC0DD\uB2D8"}
          value={`${stats.totalTeachers}명`}
          caption={collapsedPanels.teachers ? '' : "현재 필터 기준 수업 담당 인원"}
          actions={<SummaryToggleButton collapsed={collapsedPanels.teachers} onClick={() => togglePanel('teachers')} />}
        />
        <DashboardMetricCard
          icon={<Building2 size={22} />}
          label={"\uAC15\uC758\uC2E4"}
          value={`${stats.totalClassrooms}실`}
          caption={collapsedPanels.classrooms ? '' : "현재 필터 기준 사용 중인 강의실"}
          actions={<SummaryToggleButton collapsed={collapsedPanels.classrooms} onClick={() => togglePanel('classrooms')} />}
        />
      </div>

      <div className="stats-ranking-grid">
        <DashboardDataSurface
          className="stats-ranking-card"
          header={(
            <div className={`stats-ranking-card-head ${collapsedPanels.classroomUsage ? 'is-collapsed' : ''}`}>
              <div className="stats-ranking-card-title">
                <BarChart size={18} className="text-accent" />
                <h2>강의실 사용량 TOP 5</h2>
              </div>
            </div>
          )}
          actions={<CollapseButton collapsed={collapsedPanels.classroomUsage} onClick={() => togglePanel('classroomUsage')} />}
        >
          {!collapsedPanels.classroomUsage ? (
            <div className="stats-ranking-list">
              {stats.topClassrooms.length > 0 ? stats.topClassrooms.map((entry, index) => (
                <div key={entry.name} className="stats-ranking-row">
                  <div className="stats-ranking-index">
                    {index + 1}
                  </div>
                  <div className="stats-ranking-name">{entry.name}</div>
                  <ProportionalBar
                    value={entry.minutes}
                    max={stats.maxClassroomMinutes}
                    color="var(--accent-color)"
                    extraLabel={`${formatHours(entry.minutes)} · ${entry.count}개`}
                  />
                </div>
              )) : (
                <div className="stats-ranking-empty">표시할 데이터가 없습니다.</div>
              )}
            </div>
          ) : null}
        </DashboardDataSurface>

        <DashboardDataSurface
          className="stats-ranking-card"
          header={(
            <div className={`stats-ranking-card-head ${collapsedPanels.teacherWorkload ? 'is-collapsed' : ''}`}>
              <div className="stats-ranking-card-title">
                <Users size={18} className="text-accent" />
                <h2>선생님 담당량 TOP 5</h2>
              </div>
            </div>
          )}
          actions={<CollapseButton collapsed={collapsedPanels.teacherWorkload} onClick={() => togglePanel('teacherWorkload')} />}
        >
          {!collapsedPanels.teacherWorkload ? (
            <div className="stats-ranking-list">
              {stats.topTeachers.length > 0 ? stats.topTeachers.map((entry, index) => (
                <div key={entry.name} className="stats-ranking-row">
                  <div className="stats-ranking-index">
                    {index + 1}
                  </div>
                  <div className="stats-ranking-name">{entry.name}</div>
                  <ProportionalBar
                    value={entry.minutes}
                    max={stats.maxTeacherMinutes}
                    color="#b45309"
                    extraLabel={`${formatHours(entry.minutes)} · ${entry.count}개`}
                  />
                </div>
              )) : (
                <div className="stats-ranking-empty">표시할 데이터가 없습니다.</div>
              )}
            </div>
          ) : null}
        </DashboardDataSurface>
      </div>
    </div>
  );
}
