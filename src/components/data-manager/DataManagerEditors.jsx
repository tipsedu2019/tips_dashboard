import { useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2, Users } from 'lucide-react';
import { createId, getClassDisplayName } from './utils';
import { CLASS_STATUS_OPTIONS, computeClassStatus } from '../../lib/classStatus';
import { normalizeClassroomText } from '../../lib/classroomUtils';
import {
  buildSchoolMaster,
  getAllManagedGrades,
  getGradeOptionsForSelection,
  inferSchoolCategoryFromGrade,
  schoolKey,
  SCHOOL_CATEGORY_OPTIONS,
} from '../../lib/schoolConfig';

function EditorLayout({ title, description, onCancel, onSave, isSaving, children }) {
  return (
    <div className="view-container" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{title}</h2>
          {description && (
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{description}</p>
          )}
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
        {description && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{description}</p>
        )}
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
        {required && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {error && <div style={{ marginTop: 6, fontSize: 12, color: '#ef4444' }}>{error}</div>}
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
            {secondaryKey && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{secondaryKey(item)}</div>}
          </button>
          {onAddWaitlist && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0 10px', whiteSpace: 'nowrap' }}
              onClick={() => onAddWaitlist(item.id)}
            >
              대기
            </button>
          )}
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
            background: color === 'var(--accent-color)' ? 'var(--bg-surface-hover)' : 'rgba(245, 158, 11, 0.08)'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{item.name || item.className}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.meta}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button type="button" className={color === 'var(--accent-color)' ? 'btn-secondary' : 'btn-primary'} style={{ padding: '4px 10px', fontSize: 12 }} onClick={onMove ? () => onMove(item.id) : undefined}>
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

export function TextbookEditor({ textbook, onSave, onCancel, isSaving }) {
  const [edited, setEdited] = useState({ ...textbook, lessons: textbook.lessons || [], tags: textbook.tags || [] });
  const [lessonTitle, setLessonTitle] = useState('');
  const [newTag, setNewTag] = useState('');
  const [errors, setErrors] = useState({});
  const [frequentTags, setFrequentTags] = useState(() => {
    const saved = localStorage.getItem('tips_frequent_tags');
    return saved ? JSON.parse(saved) : ['영어', '수학', '국어', '중등', '고등', '내신', '독해'];
  });

  const persistFrequentTags = (nextTags) => {
    setFrequentTags(nextTags);
    localStorage.setItem('tips_frequent_tags', JSON.stringify(nextTags));
  };

  const handleSave = async () => {
    const nextErrors = {};
    if (!edited.title?.trim()) {
      nextErrors.title = '교재명을 입력해 주세요.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    await onSave(edited);
  };

  return (
    <EditorLayout
      title="교재 편집"
      description="교재 기본 정보와 차시 계획을 한 화면에서 관리합니다."
      onCancel={onCancel}
      onSave={handleSave}
      isSaving={isSaving}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(340px, 1.2fr)', gap: 24 }}>
        <SectionCard title="기본 정보">
          <Field label="교재명" required error={errors.title}>
            <input
              type="text"
              className="styled-input"
              value={edited.title || ''}
              onChange={(event) => setEdited((current) => ({ ...current, title: event.target.value }))}
            />
          </Field>

          <Field label="출판사">
            <input
              type="text"
              className="styled-input"
              value={edited.publisher || ''}
              onChange={(event) => setEdited((current) => ({ ...current, publisher: event.target.value }))}
            />
          </Field>

          <Field label="판매 금액">
            <input
              type="number"
              className="styled-input"
              value={edited.price || 0}
              onChange={(event) => setEdited((current) => ({ ...current, price: Number(event.target.value) || 0 }))}
            />
          </Field>

          <Field label="태그">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(edited.tags || []).map((tag) => (
                <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'var(--accent-light)', color: 'var(--accent-color)', fontSize: 12, fontWeight: 700 }}>
                  {tag}
                  <button
                    type="button"
                    style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
                    onClick={() => setEdited((current) => ({ ...current, tags: (current.tags || []).filter((item) => item !== tag) }))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                className="styled-input"
                placeholder="새 태그 입력"
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const tag = newTag.trim();
                  if (!tag || (edited.tags || []).includes(tag)) {
                    return;
                  }
                  setEdited((current) => ({ ...current, tags: [...(current.tags || []), tag] }));
                  if (!frequentTags.includes(tag)) {
                    persistFrequentTags([...frequentTags, tag]);
                  }
                  setNewTag('');
                }}
              >
                추가
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {frequentTags.map((tag) => {
                const selected = (edited.tags || []).includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className="btn-secondary"
                    style={{ background: selected ? 'var(--accent-light)' : 'var(--bg-surface-hover)', color: selected ? 'var(--accent-color)' : 'var(--text-secondary)', border: 'none' }}
                    onClick={() => {
                      setEdited((current) => ({
                        ...current,
                        tags: selected
                          ? (current.tags || []).filter((item) => item !== tag)
                          : [...(current.tags || []), tag]
                      }));
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </Field>
        </SectionCard>

        <SectionCard title="차시 계획" description="교재별 진행 계획을 미리 정리해 두면 수업 진도 입력이 쉬워집니다.">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type="text"
              className="styled-input"
              placeholder="차시 또는 목차 제목"
              value={lessonTitle}
              onChange={(event) => setLessonTitle(event.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (!lessonTitle.trim()) {
                  return;
                }
                setEdited((current) => ({
                  ...current,
                  lessons: [...(current.lessons || []), { id: createId(), title: lessonTitle.trim() }]
                }));
                setLessonTitle('');
              }}
            >
              <Plus size={16} />
              추가
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(edited.lessons || []).length === 0 ? (
              <div style={{ padding: '28px 16px', borderRadius: 14, background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', textAlign: 'center' }}>
                아직 등록된 차시가 없습니다.
              </div>
            ) : (
              (edited.lessons || []).map((lesson, index) => (
                <div key={lesson.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--accent-light)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>{lesson.title}</div>
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ color: '#ef4444' }}
                    onClick={() => setEdited((current) => ({ ...current, lessons: (current.lessons || []).filter((item) => item.id !== lesson.id) }))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </EditorLayout>
  );
}

export function ClassEditor({ cls, textbooks, students, requestConfirm, showToast, onSave, onCancel, isSaving }) {
  const [edited, setEdited] = useState({
    ...cls,
    status: cls.status || computeClassStatus(cls),
    classroom: normalizeClassroomText(cls.classroom || cls.room || ''),
    studentIds: cls.studentIds || [],
    waitlistIds: cls.waitlistIds || [],
    textbookIds: cls.textbookIds || [],
    lessons: cls.lessons || []
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [errors, setErrors] = useState({});
  const schoolCatalog = useMemo(
    () => buildSchoolMaster([], students || []),
    [students]
  );
  const selectedSchoolCategory = inferSchoolCategoryFromGrade(edited.grade, 'middle');
  const gradeOptions = useMemo(
    () => getGradeOptionsForSelection(selectedSchoolCategory),
    [selectedSchoolCategory]
  );

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

    await onSave(edited);
  };

  const selectedTextbook = (textbooks || []).find((item) => item.id === edited.textbookIds?.[0]);

  return (
    <EditorLayout
      title="수업 편집"
      description="수업 기본 정보, 교재, 수강생, 대기생을 한 번에 정리합니다."
      onCancel={onCancel}
      onSave={handleSave}
      isSaving={isSaving}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.15fr) minmax(320px, 1fr) minmax(320px, 1fr)', gap: 24 }}>
        <SectionCard title="수업 정보">
          <Field label="수업명" required error={errors.className}>
            <input
              type="text"
              className="styled-input"
              value={edited.className || ''}
              onChange={(event) => setEdited((current) => ({ ...current, className: event.target.value }))}
            />
          </Field>

          <Field label="학교 구분">
            <select
              className="styled-input"
              value={selectedSchoolCategory}
              onChange={(event) => {
                const nextCategory = event.target.value;
                const nextSchools = schoolCatalog.filter((item) => item.category === nextCategory);
                setEdited((current) => ({
                  ...current,
                  school: nextSchools.some((item) => schoolKey(item.name) === schoolKey(current.school)) ? current.school : '',
                  grade: getGradeOptionsForSelection(nextCategory)[0] || '',
                }));
              }}
            >
              {SCHOOL_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="과목" required error={errors.subject}>
              <input
                type="text"
                className="styled-input"
                value={edited.subject || ''}
                onChange={(event) => setEdited((current) => ({ ...current, subject: event.target.value }))}
              />
            </Field>
            <Field label="학년">
              <select
                className="styled-input"
                value={edited.grade || ''}
                onChange={(event) => setEdited((current) => ({ ...current, grade: event.target.value }))}
              >
                <option value="">학년 선택</option>
                {gradeOptions.map((grade) => (
                  <option key={grade} value={grade}>{grade}</option>
                ))}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="상태">
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="강의실">
              <input
                type="text"
                className="styled-input"
                value={edited.classroom || ''}
                onChange={(event) => setEdited((current) => ({ ...current, classroom: normalizeClassroomText(event.target.value) }))}
              />
            </Field>
          </div>

          <Field label="요일/시간">
            <textarea
              className="styled-input"
              style={{ minHeight: 88, resize: 'vertical' }}
              value={edited.schedule || ''}
              onChange={(event) => setEdited((current) => ({ ...current, schedule: event.target.value }))}
              placeholder={'예: 월수 17:30-19:00\n[3/1~4/30] 토 13:00-15:00'}
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

          <Field label="학기/기간">
            <input
              type="text"
              className="styled-input"
              value={edited.period || ''}
              onChange={(event) => setEdited((current) => ({ ...current, period: event.target.value }))}
            />
          </Field>

          <Field label="교재 연결">
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                className="styled-input"
                value={edited.textbookIds?.[0] || ''}
                onChange={(event) => {
                  const textbookId = event.target.value;
                  const textbook = textbooks.find((item) => item.id === textbookId);
                  setEdited((current) => ({
                    ...current,
                    textbookIds: textbookId ? [textbookId] : [],
                    textbookInfo: textbook ? textbook.title : ''
                  }));
                }}
              >
                <option value="">교재를 선택하세요</option>
                {(textbooks || []).map((textbook) => (
                  <option key={textbook.id} value={textbook.id}>
                    {textbook.title}
                  </option>
                ))}
              </select>
              {selectedTextbook && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    if (!selectedTextbook.lessons || selectedTextbook.lessons.length === 0) {
                      showToast.error('선택한 교재에 차시 정보가 없습니다.');
                      return;
                    }

                    const shouldAppend = await requestConfirm({
                      title: '교재 차시를 수업 계획에 추가할까요?',
                      description: '기존 계획은 유지되고 새 차시가 뒤에 이어집니다.',
                      confirmLabel: '추가',
                      cancelLabel: '취소',
                      tone: 'info'
                    });

                    if (!shouldAppend) {
                      return;
                    }

                    setEdited((current) => ({
                      ...current,
                      lessons: [
                        ...(current.lessons || []),
                        ...selectedTextbook.lessons.map((lesson) => ({
                          ...lesson,
                          id: createId()
                        }))
                      ]
                    }));
                  }}
                >
                  <BookOpen size={16} />
                  차시 불러오기
                </button>
              )}
            </div>
          </Field>
        </SectionCard>

        <SectionCard title="수업 계획">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type="text"
              className="styled-input"
              placeholder="차시 또는 진행 목표"
              value={lessonTitle}
              onChange={(event) => setLessonTitle(event.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (!lessonTitle.trim()) {
                  return;
                }
                setEdited((current) => ({
                  ...current,
                  lessons: [...(current.lessons || []), { id: createId(), title: lessonTitle.trim() }]
                }));
                setLessonTitle('');
              }}
            >
              <Plus size={16} />
              추가
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(edited.lessons || []).length === 0 ? (
              <div style={{ padding: '28px 16px', borderRadius: 14, background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', textAlign: 'center' }}>
                아직 등록된 수업 계획이 없습니다.
              </div>
            ) : (
              (edited.lessons || []).map((lesson, index) => (
                <div key={lesson.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--accent-light)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>{lesson.title}</div>
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ color: '#ef4444' }}
                    onClick={() => setEdited((current) => ({ ...current, lessons: (current.lessons || []).filter((item) => item.id !== lesson.id) }))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="수강생 관리" description="학생 검색 후 등록반 또는 대기반으로 바로 추가할 수 있습니다.">
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
                  meta: [student.school, student.grade, student.uid].filter(Boolean).join(' · ')
                }))}
                emptyText="등록된 학생이 없습니다."
                onMove={(studentId) =>
                  setEdited((current) => ({
                    ...current,
                    studentIds: (current.studentIds || []).filter((id) => id !== studentId),
                    waitlistIds: [...(current.waitlistIds || []), studentId]
                  }))
                }
                onRemove={(studentId) =>
                  setEdited((current) => ({
                    ...current,
                    studentIds: (current.studentIds || []).filter((id) => id !== studentId)
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
                  meta: [student.school, student.grade, student.uid].filter(Boolean).join(' · ')
                }))}
                emptyText="대기 중인 학생이 없습니다."
                color="#d97706"
                onMove={(studentId) =>
                  setEdited((current) => ({
                    ...current,
                    waitlistIds: (current.waitlistIds || []).filter((id) => id !== studentId),
                    studentIds: [...(current.studentIds || []), studentId]
                  }))
                }
                onRemove={(studentId) =>
                  setEdited((current) => ({
                    ...current,
                    waitlistIds: (current.waitlistIds || []).filter((id) => id !== studentId)
                  }))
                }
                moveLabel="등록 전환"
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </EditorLayout>
  );
}

export function StudentEditor({ student, classes, students = [], academicSchools = [], onSave, onCancel, isSaving }) {
  const [edited, setEdited] = useState({
    ...student,
    classIds: student.classIds || [],
    waitlistClassIds: student.waitlistClassIds || []
  });
  const [classSearch, setClassSearch] = useState('');
  const [errors, setErrors] = useState({});
  const schoolCatalog = useMemo(
    () => buildSchoolMaster(academicSchools || [], students || []),
    [academicSchools, students]
  );
  const selectedSchool = useMemo(
    () => schoolCatalog.find((item) => schoolKey(item.name) === schoolKey(edited.school)) || null,
    [edited.school, schoolCatalog]
  );
  const selectedSchoolCategory = selectedSchool?.category || inferSchoolCategoryFromGrade(edited.grade, 'middle');
  const visibleSchools = useMemo(
    () => schoolCatalog.filter((item) => item.category === selectedSchoolCategory),
    [schoolCatalog, selectedSchoolCategory]
  );
  const allGradeOptions = useMemo(() => getAllManagedGrades(), []);

  const enrolledClasses = useMemo(
    () => (edited.classIds || []).map((id) => classes.find((classItem) => classItem.id === id)).filter(Boolean),
    [classes, edited.classIds]
  );

  const waitlistedClasses = useMemo(
    () => (edited.waitlistClassIds || []).map((id) => classes.find((classItem) => classItem.id === id)).filter(Boolean),
    [classes, edited.waitlistClassIds]
  );

  const searchResults = useMemo(() => {
    const keyword = classSearch.trim().toLowerCase();
    if (!keyword) {
      return [];
    }

    const blockedIds = new Set([...(edited.classIds || []), ...(edited.waitlistClassIds || [])]);
    return (classes || [])
      .filter((classItem) => !blockedIds.has(classItem.id))
      .filter((classItem) => [classItem.className, classItem.subject, classItem.teacher, classItem.grade].filter(Boolean).join(' ').toLowerCase().includes(keyword))
      .slice(0, 6);
  }, [classSearch, classes, edited.classIds, edited.waitlistClassIds]);

  const handleSave = async () => {
    const nextErrors = {};
    if (!edited.name?.trim()) {
      nextErrors.name = '학생 이름을 입력해 주세요.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    await onSave(edited);
  };

  return (
    <EditorLayout
      title="학생 편집"
      description="학생 기본 정보와 등록반, 대기반을 함께 관리합니다."
      onCancel={onCancel}
      onSave={handleSave}
      isSaving={isSaving}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1.1fr)', gap: 24 }}>
        <SectionCard title="학생 정보">
          <Field label="이름" required error={errors.name}>
            <input
              type="text"
              className="styled-input"
              value={edited.name || ''}
              onChange={(event) => setEdited((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="학년">
              <select
                className="styled-input"
                value={edited.grade || ''}
                onChange={(event) => {
                  const nextGrade = event.target.value;
                  setEdited((current) => {
                    const currentSchool = schoolCatalog.find(
                      (item) => schoolKey(item.name) === schoolKey(current.school)
                    ) || null;
                    const nextCategory = inferSchoolCategoryFromGrade(
                      nextGrade,
                      currentSchool?.category || 'middle'
                    );
                    const shouldClearSchool = Boolean(
                      currentSchool
                      && nextGrade
                      && currentSchool.category !== nextCategory
                    );

                    return {
                      ...current,
                      grade: nextGrade,
                      school: shouldClearSchool ? '' : current.school,
                    };
                  });
                }}
              >
                <option value="">학년 선택</option>
                {allGradeOptions.map((grade) => (
                  <option key={grade} value={grade}>{grade}</option>
                ))}
              </select>
            </Field>
            <Field label="학교">
              <select
                className="styled-input"
                value={selectedSchool ? schoolKey(selectedSchool.name) : ''}
                onChange={(event) => {
                  const nextSchool = visibleSchools.find((item) => schoolKey(item.name) === event.target.value) || null;
                  setEdited((current) => ({
                    ...current,
                    school: nextSchool?.name || '',
                  }));
                }}
              >
                <option value="">학교 선택</option>
                {visibleSchools.map((school) => (
                  <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="연락처">
              <input
                type="text"
                className="styled-input"
                value={edited.contact || ''}
                onChange={(event) => setEdited((current) => ({ ...current, contact: event.target.value }))}
              />
            </Field>
            <Field label="보호자 연락처">
              <input
                type="text"
                className="styled-input"
                value={edited.parentContact || ''}
                onChange={(event) => setEdited((current) => ({ ...current, parentContact: event.target.value }))}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="학생 고유번호">
              <input
                type="text"
                className="styled-input"
                value={edited.uid || ''}
                onChange={(event) => setEdited((current) => ({ ...current, uid: event.target.value }))}
              />
            </Field>
            <Field label="등록일">
              <input
                type="date"
                className="styled-input"
                value={edited.enrollDate || ''}
                onChange={(event) => setEdited((current) => ({ ...current, enrollDate: event.target.value }))}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="수강반 관리" description="수업 검색 후 등록반 또는 대기반으로 추가할 수 있습니다.">
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <input
              type="text"
              className="styled-input"
              placeholder="수업명, 과목, 선생님 검색"
              value={classSearch}
              onChange={(event) => setClassSearch(event.target.value)}
            />
            <SearchResults
              results={searchResults}
              labelKey="className"
              onAdd={(classId) => {
                setEdited((current) => ({ ...current, classIds: [...(current.classIds || []), classId] }));
                setClassSearch('');
              }}
              onAddWaitlist={(classId) => {
                setEdited((current) => ({ ...current, waitlistClassIds: [...(current.waitlistClassIds || []), classId] }));
                setClassSearch('');
              }}
              secondaryKey={(classItem) => [classItem.subject, classItem.teacher].filter(Boolean).join(' · ')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 800 }}>등록반 {enrolledClasses.length}개</div>
              <EnrollmentList
                items={enrolledClasses.map((classItem) => ({
                  ...classItem,
                  name: getClassDisplayName(classItem),
                  meta: [classItem.subject, classItem.teacher, classItem.schedule].filter(Boolean).join(' · ')
                }))}
                emptyText="등록된 수업이 없습니다."
                onMove={(classId) =>
                  setEdited((current) => ({
                    ...current,
                    classIds: (current.classIds || []).filter((id) => id !== classId),
                    waitlistClassIds: [...(current.waitlistClassIds || []), classId]
                  }))
                }
                onRemove={(classId) =>
                  setEdited((current) => ({
                    ...current,
                    classIds: (current.classIds || []).filter((id) => id !== classId)
                  }))
                }
                moveLabel="대기 이동"
              />
            </div>

            <div>
              <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 800, color: '#d97706' }}>대기반 {waitlistedClasses.length}개</div>
              <EnrollmentList
                items={waitlistedClasses.map((classItem) => ({
                  ...classItem,
                  name: getClassDisplayName(classItem),
                  meta: [classItem.subject, classItem.teacher, classItem.schedule].filter(Boolean).join(' · ')
                }))}
                emptyText="대기 중인 수업이 없습니다."
                color="#d97706"
                onMove={(classId) =>
                  setEdited((current) => ({
                    ...current,
                    waitlistClassIds: (current.waitlistClassIds || []).filter((id) => id !== classId),
                    classIds: [...(current.classIds || []), classId]
                  }))
                }
                onRemove={(classId) =>
                  setEdited((current) => ({
                    ...current,
                    waitlistClassIds: (current.waitlistClassIds || []).filter((id) => id !== classId)
                  }))
                }
                moveLabel="등록 전환"
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </EditorLayout>
  );
}

export function StudentManifestModal({ cls, data, onClose, onManage }) {
  const classStudents = useMemo(
    () => (cls.studentIds || []).map((id) => data.students?.find((student) => student.id === id)).filter(Boolean),
    [cls.studentIds, data.students]
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(10px)'
      }}
    >
      <div className="card-custom" onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 520, padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{getClassDisplayName(cls)} 수강 명단</h3>
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>{classStudents.length}명의 학생이 등록되어 있습니다.</div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose}>
            <Plus size={18} style={{ transform: 'rotate(45deg)' }} />
          </button>
        </div>

        <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {classStudents.length === 0 ? (
            <div style={{ padding: '36px 16px', borderRadius: 14, background: 'var(--bg-surface-hover)', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Users size={32} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.35 }} />
              등록된 학생이 없습니다.
            </div>
          ) : (
            classStudents.map((student) => (
              <div key={student.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-surface-hover)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{student.name}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                    {[student.school, student.grade, student.uid].filter(Boolean).join(' · ') || '기본 정보 없음'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{student.contact || '연락처 없음'}</div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn-primary" onClick={onManage}>
            수업 편집으로 이동
          </button>
        </div>
      </div>
    </div>
  );
}
