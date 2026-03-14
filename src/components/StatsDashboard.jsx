import { useMemo, useState } from 'react';
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
import ClassDetailModal from './ClassDetailModal';
import { useDataTableControls } from '../hooks/useDataTableControls';
import { useSharedTablePreference } from '../hooks/useSharedTablePreference';
import { useAuth } from '../contexts/AuthContext';
import ManagementHeader from './data-manager/ManagementHeader';
import DataListView from './data-manager/DataListView';
import { buildClassColumns, getDefaultClassSearchText } from './data-manager/columnSchemas';
import { findExamConflictsForClasses } from '../lib/examScheduleUtils';

function MetricCard({ icon, title, value, caption }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
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
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>{title}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>{caption}</div>
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

function CollapseButton({ collapsed, onClick }) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}
    >
      {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      {collapsed ? '복구' : '최소화'}
    </button>
  );
}

export default function StatsDashboard({ classes, data, dataService, onViewStudentSchedule }) {
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [collapsedPanels, setCollapsedPanels] = useState({
    conflicts: false,
    examConflicts: false,
  });
  const { isStaff } = useAuth();

  const togglePanel = (key) => {
    setCollapsedPanels((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const stats = useMemo(() => {
    const uniqueTeachers = new Set();
    const uniqueClassrooms = new Set();
    const classroomUsage = {};
    const teacherWorkload = {};

    classes.forEach((classItem) => {
      const teacherList = splitTeacherList(classItem.teacher || '');
      const roomList = splitClassroomList(classItem.classroom || classItem.room || '');
      const slots = parseSchedule(classItem.schedule, classItem);

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
      totalEnrollee: classes.reduce((sum, classItem) => sum + (classItem.studentIds?.length || 0), 0),
      totalWaitlist: classes.reduce((sum, classItem) => sum + (classItem.waitlistIds?.length || 0), 0),
      uniqueStudents: data.students?.length || 0,
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
          meta: '선생님 시간 중복',
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
          meta: '강의실 시간 중복',
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
    () => findExamConflictsForClasses(classes, data.students || [], data.academicSchools || [], data.academicExamDays || []),
    [classes, data.academicExamDays, data.academicSchools, data.students]
  );

  const dashboardColumns = useMemo(
    () =>
      buildClassColumns({
        data,
        onOpenClassDetail: setSelectedClassForDetails,
        editable: false,
        includeRecruitment: true,
      }),
    [data]
  );

  const sharedPreference = useSharedTablePreference({
    storageKey: 'dashboard:classes',
    dataService,
    canPersist: isStaff,
  });

  const tableControls = useDataTableControls({
    storageKey: 'dashboard:classes',
    columns: dashboardColumns,
    data: classes,
    searchAccessor: (item) => getDefaultClassSearchText(item),
    defaultSortKey: 'className',
    externalState: sharedPreference.isHydrated ? sharedPreference.externalState : null,
    onStateChange: sharedPreference.isHydrated ? sharedPreference.queuePersist : null,
  });

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>개요</h1>
          <p>주요 운영 지표와 충돌 알림을 빠르게 확인하고, 아래 수업 목록에서 바로 상세 정보까지 이어집니다.</p>
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
                { key: 'student', title: '학생 시간 중복', items: conflictSummary.student, accent: '#ef4444' },
                { key: 'teacher', title: '선생님 시간 중복', items: conflictSummary.teacher, accent: '#b45309' },
                { key: 'classroom', title: '강의실 시간 중복', items: conflictSummary.classroom, accent: '#1d4ed8' },
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
          title="운영 수업"
          value={`${stats.totalClasses}개`}
          caption={`주간 총 ${formatHours(stats.totalWeeklyMinutes)} 운영 중`}
        />
        <MetricCard
          icon={<Users size={22} />}
          title="등록 인원"
          value={`${stats.totalEnrollee}명`}
          caption={`대기 ${stats.totalWaitlist}명 · 전체 학생 ${stats.uniqueStudents}명`}
        />
        <MetricCard
          icon={<User size={22} />}
          title="선생님"
          value={`${stats.totalTeachers}명`}
          caption="현재 필터 기준 수업 담당 인원"
        />
        <MetricCard
          icon={<Building2 size={22} />}
          title="강의실"
          value={`${stats.totalClassrooms}실`}
          caption="현재 필터 기준 사용 중인 강의실"
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <BarChart size={18} className="text-accent" />
            <h2 style={{ margin: 0, fontSize: 16 }}>강의실 사용량 TOP 5</h2>
          </div>
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
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Users size={18} className="text-accent" />
            <h2 style={{ margin: 0, fontSize: 16 }}>선생님 담당량 TOP 5</h2>
          </div>
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
        </div>
      </div>

      <ManagementHeader
        title="전체 수업 목록"
        count={tableControls.filteredData.length}
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="수업명, 선생님, 강의실로 검색"
      />

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <DataListView
          columns={tableControls.visibleColumns}
          listData={tableControls.filteredData}
          rowModels={tableControls.rowModels}
          emptyTitle="표시할 수업이 없습니다"
          emptyDescription="검색어나 필터를 조정해 주세요."
          onEdit={setSelectedClassForDetails}
          onDelete={() => {}}
          selectedIds={[]}
          currentIds={tableControls.currentIds}
          toggleSelectAll={() => {}}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          onDragStart={() => {}}
          onDragEnter={() => {}}
          activeTab="classes"
          onInlineEdit={async () => {}}
          isBusy={false}
          selectable={false}
          showActions={false}
          sortKey={tableControls.sortState.key}
          sortDirection={tableControls.sortState.direction}
          onSortChange={tableControls.toggleSort}
        />
      </div>

      {selectedClassForDetails && (
        <ClassDetailModal
          classItem={selectedClassForDetails}
          data={data}
          onClose={() => setSelectedClassForDetails(null)}
          dataService={dataService}
        />
      )}
    </div>
  );
}
