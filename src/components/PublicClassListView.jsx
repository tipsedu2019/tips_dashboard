import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Eye,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  parseSchedule,
  splitClassroomList,
  splitTeacherList,
  stripClassPrefix,
} from '../data/sampleData';
import { ACTIVE_CLASS_STATUS, computeClassStatus } from '../lib/classStatus';
import { compareSubjects, sortSubjectOptions } from '../lib/subjectUtils';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';

const GRADE_ORDER = ['초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const GROUP_OPTIONS = [
  { key: 'grade', label: '학년별 보기' },
  { key: 'teacher', label: '선생님별 보기' },
  { key: 'classroom', label: '강의실별 보기' },
];

function normalizeText(value) {
  return String(value || '').trim();
}

function getGradeWeight(grade) {
  const index = GRADE_ORDER.indexOf(normalizeText(grade));
  return index === -1 ? 999 : index;
}

function buildSearchText(classItem) {
  return [
    classItem.subject,
    classItem.grade,
    stripClassPrefix(classItem.className),
    classItem.teacher,
    classItem.classroom,
    classItem.room,
    classItem.schedule,
    classItem.period,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildScheduleLines(classItem) {
  return parseSchedule(classItem.schedule, classItem)
    .map((slot) => `${slot.day} ${slot.start}-${slot.end}`)
    .filter(Boolean);
}

function sortClasses(left, right) {
  const subjectCompare = compareSubjects(left.subject, right.subject);
  if (subjectCompare !== 0) {
    return subjectCompare;
  }

  const gradeCompare = getGradeWeight(left.grade) - getGradeWeight(right.grade);
  if (gradeCompare !== 0) {
    return gradeCompare;
  }

  return stripClassPrefix(left.className || '').localeCompare(stripClassPrefix(right.className || ''), 'ko');
}

function buildGroups(classes, mode) {
  const groups = new Map();

  classes
    .slice()
    .sort(sortClasses)
    .forEach((classItem) => {
      let keys = [];

      if (mode === 'teacher') {
        keys = splitTeacherList(classItem.teacher);
      } else if (mode === 'classroom') {
        keys = splitClassroomList(classItem.classroom || classItem.room);
      } else {
        keys = [normalizeText(classItem.grade) || '학년 미정'];
      }

      if (keys.length === 0) {
        keys = [mode === 'teacher' ? '선생님 미정' : mode === 'classroom' ? '강의실 미정' : '학년 미정'];
      }

      keys.forEach((key) => {
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(classItem);
      });
    });

  return [...groups.entries()].sort(([left], [right]) => {
    if (mode === 'grade') {
      return getGradeWeight(left) - getGradeWeight(right);
    }

    return normalizeText(left).localeCompare(normalizeText(right), 'ko');
  });
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active ? '1px solid rgba(21, 94, 73, 0.22)' : '1px solid rgba(15, 23, 42, 0.08)',
        background: active ? 'linear-gradient(135deg, #216e4e 0%, #184f39 100%)' : '#ffffff',
        color: active ? '#ffffff' : '#475569',
        borderRadius: 999,
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: 800,
        cursor: 'pointer',
        boxShadow: active ? '0 12px 24px rgba(21, 94, 73, 0.16)' : 'none',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 22,
        background: '#ffffff',
        border: `1px solid ${accent}22`,
        boxShadow: '0 16px 36px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: accent }}>{value}</div>
    </div>
  );
}

function InfoPanel({ title, icon: Icon, lines, tone = 'green' }) {
  const palette = tone === 'bronze'
    ? {
      bg: '#fbf4e8',
      color: '#8a5a18',
    }
    : tone === 'blue'
      ? {
        bg: '#eef5ff',
        color: '#2355a3',
      }
      : {
        bg: '#f3f8f4',
        color: '#216e4e',
      };

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 20,
        background: palette.bg,
        border: '1px solid rgba(15, 23, 42, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 900, color: palette.color }}>
        <Icon size={14} />
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 700, color: '#223041' }}>
        {lines.length > 0 ? lines.map((line) => <span key={line}>{line}</span>) : <span>미정</span>}
      </div>
    </div>
  );
}

function PublicClassCard({ classItem, onOpenPlan }) {
  const scheduleLines = buildScheduleLines(classItem);
  const teacherLines = splitTeacherList(classItem.teacher);
  const classroomLines = splitClassroomList(classItem.classroom || classItem.room);
  const capacity = Number(classItem.capacity || 0);
  const enrolled = (classItem.studentIds || []).length;
  const metaParts = [
    classItem.period ? classItem.period : '',
    capacity > 0 ? `정원 ${capacity}명 · 현재 ${enrolled}명` : '',
  ].filter(Boolean);

  return (
    <article
      style={{
        position: 'relative',
        padding: 24,
        borderRadius: 28,
        background: 'linear-gradient(180deg, #fffdf8 0%, #ffffff 100%)',
        border: '1px solid rgba(15, 23, 42, 0.08)',
        boxShadow: '0 20px 40px rgba(15, 23, 42, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        minHeight: 312,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(184, 134, 11, 0.10)',
              color: '#8a5a18',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {classItem.subject || '과목 미정'}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(21, 94, 73, 0.12)',
              color: '#155e49',
              border: '1px solid rgba(21, 94, 73, 0.16)',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            수업 진행 중
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{classItem.grade || '학년 미정'}</div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => onOpenPlan(classItem)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            color: '#12202f',
          }}
        >
          <div style={{ fontSize: 24, lineHeight: 1.22, fontWeight: 900, letterSpacing: '-0.03em' }}>
            {stripClassPrefix(classItem.className || '이름 없는 수업')}
          </div>
        </button>
        <div style={{ marginTop: 10, fontSize: 13, color: '#64748b', lineHeight: 1.7 }}>
          {metaParts.join(' · ')}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <InfoPanel title="요일 / 시간" icon={CalendarDays} lines={scheduleLines} tone="bronze" />
        <InfoPanel title="선생님" icon={UserRound} lines={teacherLines} tone="green" />
        <InfoPanel title="강의실" icon={Building2} lines={classroomLines} tone="blue" />
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
          수업명을 누르면 수업 일정표와 기본 정보를 함께 볼 수 있습니다.
        </div>
        <button
          type="button"
          onClick={() => onOpenPlan(classItem)}
          className="btn btn-primary"
        >
          일정표 보기
          <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );
}

export default function PublicClassListView({
  classes = [],
  isLoading = false,
  onLogin,
  showBackToDashboard = false,
  onBackToDashboard,
}) {
  const [subjectFilter, setSubjectFilter] = useState('전체');
  const [gradeFilter, setGradeFilter] = useState('전체');
  const [groupMode, setGroupMode] = useState('grade');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDetailTable, setShowDetailTable] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);

  const visibleClasses = useMemo(
    () => (classes || []).filter((classItem) => computeClassStatus(classItem) === ACTIVE_CLASS_STATUS),
    [classes]
  );

  const subjectOptions = useMemo(
    () => ['전체', ...sortSubjectOptions(visibleClasses.map((classItem) => classItem.subject), { includeDefaults: false })],
    [visibleClasses]
  );

  const gradeOptions = useMemo(() => {
    const values = [...new Set(visibleClasses.map((classItem) => normalizeText(classItem.grade)).filter(Boolean))];
    return ['전체', ...values.sort((left, right) => getGradeWeight(left) - getGradeWeight(right) || left.localeCompare(right, 'ko'))];
  }, [visibleClasses]);

  const filteredClasses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return visibleClasses
      .filter((classItem) => subjectFilter === '전체' || classItem.subject === subjectFilter)
      .filter((classItem) => gradeFilter === '전체' || normalizeText(classItem.grade) === gradeFilter)
      .filter((classItem) => !query || buildSearchText(classItem).includes(query))
      .sort(sortClasses);
  }, [gradeFilter, searchQuery, subjectFilter, visibleClasses]);

  const groupedClasses = useMemo(() => buildGroups(filteredClasses, groupMode), [filteredClasses, groupMode]);

  const stats = useMemo(() => {
    const teacherCount = new Set(
      visibleClasses.flatMap((classItem) => splitTeacherList(classItem.teacher))
    ).size;
    const classroomCount = new Set(
      visibleClasses.flatMap((classItem) => splitClassroomList(classItem.classroom || classItem.room))
    ).size;

    return {
      active: visibleClasses.length,
      teacherCount,
      classroomCount,
      gradeCount: new Set(visibleClasses.map((classItem) => normalizeText(classItem.grade)).filter(Boolean)).size,
    };
  }, [visibleClasses]);

  const tableRows = useMemo(() => filteredClasses.slice(0, 24), [filteredClasses]);
  const publicSelectedClass = selectedClass
    ? {
      ...selectedClass,
      displayClassName: stripClassPrefix(selectedClass.className || selectedClass.name || ''),
    }
    : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f3efe4 0%, #f8f6ef 34%, #ffffff 100%)',
        color: '#12202f',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backdropFilter: 'blur(20px)',
          background: 'rgba(243, 239, 228, 0.84)',
          borderBottom: '1px solid rgba(18, 32, 47, 0.08)',
        }}
      >
        <div
          style={{
            maxWidth: 1320,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src="/logo_tips.png"
              alt="TIPS Academy"
              style={{ width: 44, height: 44, borderRadius: 14, boxShadow: '0 10px 22px rgba(18, 32, 47, 0.16)' }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5a18', letterSpacing: '0.08em' }}>PUBLIC TIMETABLE</div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em' }}>팁스영어수학학원 수업시간표</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {showBackToDashboard ? (
              <button type="button" className="btn btn-primary" onClick={onBackToDashboard}>
                운영 화면으로 돌아가기
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={onLogin}>
                직원 로그인
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 24px 80px' }}>
        <section
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 36,
            padding: '36px 32px',
            background: 'linear-gradient(135deg, rgba(21, 94, 73, 0.96) 0%, rgba(24, 79, 57, 0.96) 52%, rgba(102, 67, 22, 0.94) 100%)',
            color: '#f8f6ef',
            boxShadow: '0 28px 60px rgba(18, 32, 47, 0.16)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 'auto -80px -100px auto',
              width: 280,
              height: 280,
              borderRadius: 999,
              background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)',
            }}
          />
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', gap: 24, alignItems: 'end' }}>
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.14)',
                  fontSize: 12,
                  fontWeight: 800,
                  marginBottom: 18,
                }}
              >
                <Sparkles size={14} />
                현재 운영 중인 수업 안내
              </div>
              <h1 style={{ margin: 0, fontSize: 'clamp(34px, 5vw, 58px)', lineHeight: 1.04, letterSpacing: '-0.05em', fontWeight: 900 }}>
                찾기 쉽고,
                <br />
                보기 편한 공개 시간표.
              </h1>
              <p style={{ margin: '18px 0 0', maxWidth: 700, fontSize: 16, lineHeight: 1.8, color: 'rgba(248, 246, 239, 0.88)' }}>
                과목, 학년, 선생님, 강의실 기준으로 현재 진행 중인 수업을 빠르게 찾아보고,
                수업명을 눌러 수업 일정표까지 바로 확인할 수 있습니다.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 12,
              }}
            >
              <StatCard label="진행 중 수업" value={stats.active} accent="#f3d59a" />
              <StatCard label="선생님" value={stats.teacherCount} accent="#d4f2d5" />
              <StatCard label="강의실" value={stats.classroomCount} accent="#cbe0ff" />
              <StatCard label="학년 그룹" value={stats.gradeCount} accent="#efd7ff" />
            </div>
          </div>
        </section>

        <section
          style={{
            position: 'sticky',
            top: 84,
            zIndex: 90,
            marginTop: 20,
            padding: 18,
            borderRadius: 28,
            background: 'rgba(255,255,255,0.86)',
            backdropFilter: 'blur(18px)',
            border: '1px solid rgba(18, 32, 47, 0.08)',
            boxShadow: '0 18px 38px rgba(18, 32, 47, 0.08)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(0, 2fr)', gap: 18 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 14px',
                height: 48,
                borderRadius: 18,
                border: '1px solid rgba(18, 32, 47, 0.08)',
                background: '#ffffff',
              }}
            >
              <Search size={18} color="#64748b" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="수업명, 선생님, 강의실 검색"
                style={{
                  border: 'none',
                  outline: 'none',
                  width: '100%',
                  background: 'transparent',
                  fontSize: 14,
                  color: '#12202f',
                }}
              />
            </label>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {GROUP_OPTIONS.map((option) => (
                <FilterChip key={option.key} active={groupMode === option.key} onClick={() => setGroupMode(option.key)}>
                  {option.label}
                </FilterChip>
              ))}
              <FilterChip active={showDetailTable} onClick={() => setShowDetailTable((current) => !current)}>
                {showDetailTable ? '상세표 숨기기' : '상세표 보기'}
              </FilterChip>
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {subjectOptions.map((option) => (
                <FilterChip key={option} active={subjectFilter === option} onClick={() => setSubjectFilter(option)}>
                  {option}
                </FilterChip>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {gradeOptions.map((option) => (
                <FilterChip key={option} active={gradeFilter === option} onClick={() => setGradeFilter(option)}>
                  {option}
                </FilterChip>
              ))}
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>
          {isLoading ? (
            <div
              style={{
                padding: 56,
                borderRadius: 28,
                background: '#ffffff',
                border: '1px solid rgba(18, 32, 47, 0.08)',
                textAlign: 'center',
                color: '#64748b',
                fontWeight: 700,
              }}
            >
              공개 시간표를 불러오는 중입니다.
            </div>
          ) : filteredClasses.length === 0 ? (
            <div
              style={{
                padding: 56,
                borderRadius: 28,
                background: '#ffffff',
                border: '1px solid rgba(18, 32, 47, 0.08)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 999,
                  margin: '0 auto 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(21, 94, 73, 0.08)',
                  color: '#216e4e',
                }}
              >
                <Eye size={28} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#12202f', marginBottom: 10 }}>
                조건에 맞는 수업이 아직 없습니다
              </div>
              <div style={{ fontSize: 15, color: '#64748b', lineHeight: 1.8 }}>
                과목이나 학년 필터를 바꾸거나 검색어를 지운 뒤 다시 확인해 주세요.
              </div>
            </div>
          ) : (
            groupedClasses.map(([groupName, groupItems]) => (
              <section key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 16,
                    alignItems: 'end',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5a18', letterSpacing: '0.06em' }}>
                      {groupMode === 'grade' ? 'GRADE CURATION' : groupMode === 'teacher' ? 'TEACHER CURATION' : 'CLASSROOM CURATION'}
                    </div>
                    <h2 style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em' }}>
                      {groupName}
                    </h2>
                  </div>
                  <div style={{ fontSize: 14, color: '#64748b', fontWeight: 700 }}>
                    수업 {groupItems.length}개
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 18,
                  }}
                >
                  {groupItems.map((classItem) => (
                    <PublicClassCard key={`${groupName}-${classItem.id}`} classItem={classItem} onOpenPlan={setSelectedClass} />
                  ))}
                </div>
              </section>
            ))
          )}
        </section>

        {showDetailTable && tableRows.length > 0 && (
          <section
            style={{
              marginTop: 36,
              borderRadius: 28,
              background: '#ffffff',
              border: '1px solid rgba(18, 32, 47, 0.08)',
              boxShadow: '0 18px 40px rgba(18, 32, 47, 0.06)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid rgba(18, 32, 47, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5a18', marginBottom: 6 }}>DETAIL TABLE</div>
                <div style={{ fontSize: 20, fontWeight: 900 }}>전체 수업 한눈에 보기</div>
              </div>
              <div style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>
                상위 {tableRows.length}개 수업 표시
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                <thead>
                  <tr style={{ background: '#f8f6ef' }}>
                    {['과목', '학년', '수업명', '요일 / 시간', '선생님', '강의실'].map((label) => (
                      <th key={label} style={{ padding: '16px 18px', textAlign: 'left', fontSize: 12, fontWeight: 800, color: '#64748b' }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((classItem) => (
                    <tr key={classItem.id} className="public-row-hover" style={{ borderTop: '1px solid rgba(18, 32, 47, 0.06)' }}>
                      <td style={{ padding: '16px 18px', fontWeight: 800, color: '#216e4e' }}>{classItem.subject || '-'}</td>
                      <td style={{ padding: '16px 18px', color: '#475569', fontWeight: 700 }}>{classItem.grade || '-'}</td>
                      <td style={{ padding: '16px 18px' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedClass(classItem)}
                          style={{ border: 'none', background: 'transparent', padding: 0, color: '#12202f', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}
                        >
                          {stripClassPrefix(classItem.className || '이름 없는 수업')}
                        </button>
                      </td>
                      <td style={{ padding: '16px 18px', color: '#475569', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                        {buildScheduleLines(classItem).join('\n') || '-'}
                      </td>
                      <td style={{ padding: '16px 18px', color: '#12202f' }}>{splitTeacherList(classItem.teacher).join(', ') || '-'}</td>
                      <td style={{ padding: '16px 18px', color: '#12202f' }}>{splitClassroomList(classItem.classroom || classItem.room).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <ClassSchedulePlanModal
        open={Boolean(publicSelectedClass)}
        classItem={publicSelectedClass}
        plan={publicSelectedClass?.schedulePlan || publicSelectedClass?.schedule_plan || null}
        emptyMessage="아직 등록된 일정표가 없습니다."
        onClose={() => setSelectedClass(null)}
      />
    </div>
  );
}
