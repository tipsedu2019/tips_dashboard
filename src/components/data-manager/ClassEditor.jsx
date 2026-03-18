import { useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Trash2 } from 'lucide-react';
import { CLASS_STATUS_OPTIONS, computeClassStatus } from '../../lib/classStatus';
import { normalizeClassroomText } from '../../lib/classroomUtils';
import { buildSchedulePlanForSave } from '../../lib/classSchedulePlanner';
import { getAllManagedGrades } from '../../lib/schoolConfig';
import ClassSchedulePlanPreview from '../ClassSchedulePlanPreview';
import ClassSchedulePlanModal from '../ClassSchedulePlanModal';
import { getClassExamConflicts } from '../../lib/examScheduleUtils';

function EditorLayout({ title, description, onCancel, onSave, isSaving, children }) {
  return (
    <div className="view-container" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{title}</h2>
          {description ? (
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{description}</p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isSaving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={isSaving}>
            저장
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function SectionCard({ title, description, children, style }) {
  return (
    <div className="card-custom p-6" style={style}>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h3>
        {description ? (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Field({ label, required = false, children, error }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
        {label}
        {required ? <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span> : null}
      </label>
      {children}
      {error ? <div style={{ marginTop: 6, fontSize: 12, color: '#ef4444' }}>{error}</div> : null}
    </div>
  );
}

function SearchResults({ results, onAdd, onAddWaitlist, labelKey = 'name', secondaryKey }) {
  if (results.length === 0) {
    return null;
  }

  return (
    <div className="card-custom" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 20, padding: 8 }}>
      {results.map((item) => (
        <div key={item.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button
            type="button"
            className="list-item-hover"
            style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onAdd(item.id)}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>{item[labelKey]}</div>
            {secondaryKey ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{secondaryKey(item)}</div> : null}
          </button>
          {onAddWaitlist ? (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0 10px', whiteSpace: 'nowrap' }}
              onClick={() => onAddWaitlist(item.id)}
            >
              대기
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EnrollmentList({ items, emptyText, color = 'var(--accent-color)', onMove, onRemove, moveLabel }) {
  if (items.length === 0) {
    return (
      <div style={{ padding: '28px 16px', borderRadius: 14, background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', textAlign: 'center' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${color === 'var(--accent-color)' ? 'var(--border-color)' : 'rgba(245, 158, 11, 0.3)'}`,
            background: color === 'var(--accent-color)' ? 'var(--bg-surface-hover)' : 'rgba(245, 158, 11, 0.08)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{item.name || item.className}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.meta}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className={color === 'var(--accent-color)' ? 'btn-secondary' : 'btn-primary'}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onMove ? () => onMove(item.id) : undefined}
            >
              {moveLabel}
            </button>
            <button type="button" className="btn-icon" style={{ color: '#ef4444' }} onClick={() => onRemove(item.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ClassEditor({
  cls,
  textbooks,
  students,
  classTerms = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = [],
  onSave,
  onCancel,
  isSaving,
}) {
  const [edited, setEdited] = useState({
    ...cls,
    status: cls.status || computeClassStatus(cls),
    classroom: normalizeClassroomText(cls.classroom || cls.room || ''),
    studentIds: cls.studentIds || [],
    waitlistIds: cls.waitlistIds || [],
    textbookIds: cls.textbookIds || [],
    lessons: cls.lessons || [],
    schedulePlan: cls.schedulePlan || cls.schedule_plan || null,
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [errors, setErrors] = useState({});
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  const enrolledStudents = useMemo(
    () => (edited.studentIds || []).map((id) => students.find((student) => student.id === id)).filter(Boolean),
    [edited.studentIds, students]
  );

  const waitlistedStudents = useMemo(
    () => (edited.waitlistIds || []).map((id) => students.find((student) => student.id === id)).filter(Boolean),
    [edited.waitlistIds, students]
  );

  const searchResults = useMemo(() => {
    const keyword = studentSearch.trim().toLowerCase();
    if (!keyword) {
      return [];
    }

    const blockedIds = new Set([...(edited.studentIds || []), ...(edited.waitlistIds || [])]);
    return (students || [])
      .filter((student) => !blockedIds.has(student.id))
      .filter((student) => [student.name, student.school, student.grade, student.uid].filter(Boolean).join(' ').toLowerCase().includes(keyword))
      .slice(0, 6);
  }, [edited.studentIds, edited.waitlistIds, studentSearch, students]);

  const selectedTextbook = (textbooks || []).find((item) => item.id === edited.textbookIds?.[0]) || null;
  const sortedClassTerms = useMemo(
    () => [...(classTerms || [])].sort((left, right) => {
      const yearGap = Number(right.academicYear || 0) - Number(left.academicYear || 0);
      if (yearGap !== 0) {
        return yearGap;
      }
      return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    }),
    [classTerms]
  );
  const examConflicts = useMemo(
    () => getClassExamConflicts(
      edited,
      students,
      academicSchools,
      academicExamDays,
      academicEventExamDetails,
      academicEvents
    ),
    [academicEventExamDetails, academicEvents, academicExamDays, academicSchools, edited, students]
  );
  const planWarningBanner = examConflicts.length > 0
    ? `시험일과 수업일이 겹칩니다. ${examConflicts.map((conflict) => `${conflict.examDate} ${conflict.subject} (${conflict.students.join(', ')})`).join(' / ')}`
    : null;

  const handleSave = async () => {
    const nextErrors = {};
    if (!edited.className?.trim()) {
      nextErrors.className = '수업명을 입력해 주세요.';
    }
    if (!edited.subject?.trim()) {
      nextErrors.subject = '과목을 입력해 주세요.';
    }
    if (!edited.teacher?.trim()) {
      nextErrors.teacher = '선생님을 입력해 주세요.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const hasSchedulePlanContent = Boolean(
      edited.schedulePlan && (
        (edited.schedulePlan.selectedDays || []).length > 0 ||
        (edited.schedulePlan.sessions || []).length > 0 ||
        (edited.schedulePlan.billingPeriods || []).some((period) => period?.startDate || period?.endDate)
      )
    );

    await onSave({
      ...edited,
      classroom: normalizeClassroomText(edited.classroom || ''),
      schedulePlan: hasSchedulePlanContent ? buildSchedulePlanForSave(edited.schedulePlan, edited) : null,
    });
  };

  return (
    <EditorLayout
      title="수업 편집"
      description="수업 기본 정보, 일정표, 수강생을 한 화면에서 함께 관리합니다."
      onCancel={onCancel}
      onSave={handleSave}
      isSaving={isSaving}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 0.95fr) minmax(540px, 1.35fr)', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <SectionCard title="수업 정보" description="기본 정보와 반복 시간표를 먼저 정리하면 일정표 생성이 자연스럽게 이어집니다.">
            <Field label="수업명" required error={errors.className}>
              <input
                type="text"
                className="styled-input"
                value={edited.className || ''}
                onChange={(event) => setEdited((current) => ({ ...current, className: event.target.value }))}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="과목" required error={errors.subject}>
                <input
                  type="text"
                  className="styled-input"
                  value={edited.subject || ''}
                  onChange={(event) => setEdited((current) => ({ ...current, subject: event.target.value }))}
                  placeholder="영어 또는 수학"
                />
              </Field>
              <Field label="학년">
                <select
                  className="styled-input"
                  value={edited.grade || ''}
                  onChange={(event) => setEdited((current) => ({ ...current, grade: event.target.value }))}
                >
                  <option value="">학년 선택</option>
                  {getAllManagedGrades().map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="운영 상태">
                <select
                  className="styled-input"
                  value={edited.status || computeClassStatus(edited)}
                  onChange={(event) => setEdited((current) => ({ ...current, status: event.target.value }))}
                >
                  {CLASS_STATUS_OPTIONS.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {statusOption}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="선생님" required error={errors.teacher}>
                <input
                  type="text"
                  className="styled-input"
                  value={edited.teacher || ''}
                  onChange={(event) => setEdited((current) => ({ ...current, teacher: event.target.value }))}
                />
              </Field>
            </div>

            <Field label="강의실">
              <input
                type="text"
                className="styled-input"
                value={edited.classroom || ''}
                onChange={(event) => setEdited((current) => ({ ...current, classroom: normalizeClassroomText(event.target.value) }))}
                placeholder="예: 본7, [별5], 본관 2강"
              />
            </Field>

            <Field label="요일/시간">
              <textarea
                className="styled-input"
                style={{ minHeight: 88, resize: 'vertical' }}
                value={edited.schedule || ''}
                onChange={(event) => setEdited((current) => ({ ...current, schedule: event.target.value }))}
                placeholder={'월수 17:30-19:00\n[3/1~4/30] 토 13:00-15:00'}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="정원">
                <input
                  type="number"
                  className="styled-input"
                  value={edited.capacity || 0}
                  onChange={(event) => setEdited((current) => ({ ...current, capacity: Number(event.target.value) || 0 }))}
                />
              </Field>
              <Field label="수업료">
                <input
                  type="number"
                  className="styled-input"
                  value={edited.fee || 0}
                  onChange={(event) => setEdited((current) => ({ ...current, fee: Number(event.target.value) || 0 }))}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="시작일">
                <input
                  type="date"
                  className="styled-input"
                  value={edited.startDate || ''}
                  onChange={(event) => setEdited((current) => ({ ...current, startDate: event.target.value }))}
                />
              </Field>
              <Field label="종료일">
                <input
                  type="date"
                  className="styled-input"
                  value={edited.endDate || ''}
                  onChange={(event) => setEdited((current) => ({ ...current, endDate: event.target.value }))}
                />
              </Field>
            </div>

            <Field label="학기">
              <select
                className="styled-input"
                value={edited.termId || ''}
                onChange={(event) => {
                  const nextTermId = event.target.value;
                  const nextTerm = sortedClassTerms.find((term) => term.id === nextTermId) || null;
                  const persistedTermId = nextTerm && !nextTerm.localOnly && !nextTerm.legacyOnly ? nextTermId : null;
                  setEdited((current) => ({
                    ...current,
                    termId: persistedTermId,
                    term_id: persistedTermId,
                    period: nextTerm?.name || '',
                  }));
                }}
              >
                <option value="">학기 미지정</option>
                {sortedClassTerms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {[term.academicYear, term.name, term.status].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="학기명 표시">
              <input
                type="text"
                className="styled-input"
                value={edited.period || ''}
                onChange={(event) => setEdited((current) => ({ ...current, period: event.target.value }))}
                placeholder="학기 선택 시 자동 입력됩니다"
              />
            </Field>

            <Field label="교재 연결">
              <select
                className="styled-input"
                value={edited.textbookIds?.[0] || ''}
                onChange={(event) => {
                  const textbookId = event.target.value;
                  const textbook = textbooks.find((item) => item.id === textbookId);
                  setEdited((current) => ({
                    ...current,
                    textbookIds: textbookId ? [textbookId] : [],
                    textbookInfo: textbook ? textbook.title : '',
                  }));
                }}
              >
                <option value="">교재를 선택하세요.</option>
                {(textbooks || []).map((textbook) => (
                  <option key={textbook.id} value={textbook.id}>
                    {textbook.title}
                  </option>
                ))}
              </select>
            </Field>

            {selectedTextbook ? (
              <div
                style={{
                  marginTop: 4,
                  padding: '14px 16px',
                  borderRadius: 16,
                  background: 'var(--accent-light)',
                  color: 'var(--accent-color)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, marginBottom: 4 }}>
                  <BookOpen size={16} />
                  {selectedTextbook.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  진도 기록과 교재 차시는 기존 교재 탭 기준으로 그대로 관리됩니다. 수업 계획 일정표는 이 교재 정보와 별도로 저장됩니다.
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="수강생 관리" description="학생 검색 후 등록반 또는 대기반으로 바로 이동시킬 수 있습니다.">
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input
                type="text"
                className="styled-input"
                placeholder="학생 이름, 학교, 학년 검색"
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
              />
              <SearchResults
                results={searchResults}
                onAdd={(studentId) => {
                  setEdited((current) => ({ ...current, studentIds: [...(current.studentIds || []), studentId] }));
                  setStudentSearch('');
                }}
                onAddWaitlist={(studentId) => {
                  setEdited((current) => ({ ...current, waitlistIds: [...(current.waitlistIds || []), studentId] }));
                  setStudentSearch('');
                }}
                secondaryKey={(student) => [student.school, student.grade].filter(Boolean).join(' ')}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 800 }}>등록반 학생 {enrolledStudents.length}명</div>
                <EnrollmentList
                  items={enrolledStudents.map((student) => ({
                    ...student,
                    meta: [student.school, student.grade, student.uid].filter(Boolean).join(' · '),
                  }))}
                  emptyText="등록된 학생이 없습니다."
                  onMove={(studentId) =>
                    setEdited((current) => ({
                      ...current,
                      studentIds: (current.studentIds || []).filter((id) => id !== studentId),
                      waitlistIds: [...(current.waitlistIds || []), studentId],
                    }))
                  }
                  onRemove={(studentId) =>
                    setEdited((current) => ({
                      ...current,
                      studentIds: (current.studentIds || []).filter((id) => id !== studentId),
                    }))
                  }
                  moveLabel="대기 이동"
                />
              </div>

              <div>
                <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 800, color: '#d97706' }}>대기반 학생 {waitlistedStudents.length}명</div>
                <EnrollmentList
                  items={waitlistedStudents.map((student) => ({
                    ...student,
                    meta: [student.school, student.grade, student.uid].filter(Boolean).join(' · '),
                  }))}
                  emptyText="대기 중인 학생이 없습니다."
                  color="#d97706"
                  onMove={(studentId) =>
                    setEdited((current) => ({
                      ...current,
                      waitlistIds: (current.waitlistIds || []).filter((id) => id !== studentId),
                      studentIds: [...(current.studentIds || []), studentId],
                    }))
                  }
                  onRemove={(studentId) =>
                    setEdited((current) => ({
                      ...current,
                      waitlistIds: (current.waitlistIds || []).filter((id) => id !== studentId),
                    }))
                  }
                  moveLabel="등록 전환"
                />
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="수업 계획"
          description="수업 일정표는 풀스크린 모달에서 편집합니다. 저장된 일정표는 퍼블릭 페이지와 수업 상세에서도 그대로 열어볼 수 있습니다."
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                기본 회차는 선택한 주간 수업 요일 수 × 4주로 잡힙니다. 휴강, 보강, 미정 수업일을 넓은 화면에서 편하게 조정해 주세요.
              </div>
              {planWarningBanner ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.18)',
                    color: '#b91c1c',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {planWarningBanner}
                </div>
              ) : null}
            </div>
            <button type="button" className="btn-primary" onClick={() => setIsPlanModalOpen(true)}>
              <CalendarDays size={18} />
              수업 계획 열기
            </button>
          </div>

          <ClassSchedulePlanPreview
            plan={edited.schedulePlan}
            className={edited.className || ''}
            subject={edited.subject || ''}
            emptyMessage="아직 저장된 수업 일정표가 없습니다."
          />
        </SectionCard>
      </div>
      <ClassSchedulePlanModal
        open={isPlanModalOpen}
        editable
        classItem={edited}
        plan={edited.schedulePlan}
        onPlanChange={(nextPlan) => setEdited((current) => ({ ...current, schedulePlan: nextPlan }))}
        onSubjectChange={(nextSubject, nextPlan) => setEdited((current) => ({
          ...current,
          subject: nextSubject,
          schedulePlan: nextPlan || current.schedulePlan,
        }))}
        onClassNameChange={(nextClassName, nextPlan) => setEdited((current) => ({
          ...current,
          className: nextClassName,
          schedulePlan: nextPlan || current.schedulePlan,
        }))}
        warningBanner={planWarningBanner}
        onClose={() => setIsPlanModalOpen(false)}
      />
    </EditorLayout>
  );
}
