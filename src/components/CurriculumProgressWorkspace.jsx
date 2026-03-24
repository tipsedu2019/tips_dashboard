import { useEffect, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';
import { PublicLandingCard } from './PublicClassLandingView';
import ManagementCommandBar from './data-manager/ManagementCommandBar';
import { Badge, CheckboxMenu, SegmentedControl, StateView } from './ui/tds';
import {
  buildSchedulePlanForSave,
  calculateSchedulePlan,
  normalizeSchedulePlan,
} from '../lib/classSchedulePlanner';
import {
  buildClassroomMaster,
  buildTeacherMaster,
  getResourceSubjectOptions,
} from '../lib/resourceCatalogs';
import { splitTeacherList } from '../data/sampleData';

function text(value) {
  return String(value || '').trim();
}

function filterResourceOptionsBySubjects(master = [], selectedSubjects = []) {
  const visibleEntries = (master || []).filter((item) => item?.isVisible !== false);
  if (!Array.isArray(selectedSubjects) || selectedSubjects.length === 0) {
    return visibleEntries.map((item) => item.name).filter(Boolean);
  }

  const subjectSet = new Set(selectedSubjects.filter(Boolean));
  return visibleEntries
    .filter((item) => {
      const subjects = Array.isArray(item?.subjects) ? item.subjects.filter(Boolean) : [];
      return subjects.some((subject) => subjectSet.has(subject));
    })
    .map((item) => item.name)
    .filter(Boolean);
}

function getLastUpdatedAt(plan = null) {
  const normalized = normalizeSchedulePlan(plan || null);
  const calculated = calculateSchedulePlan(normalized);
  const timestamps = (calculated.sessions || [])
    .flatMap((session) =>
      (session.textbookEntries || []).map((entry) => entry.actual?.updatedAt || ''),
    )
    .filter(Boolean)
    .sort();

  return timestamps[timestamps.length - 1] || '';
}

function formatDateText(value) {
  if (!value) {
    return '업데이트 없음';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function buildTermOptions(classes = [], classTerms = []) {
  const optionMap = new Map();

  (classTerms || []).forEach((term, index) => {
    const name = text(term?.name || term?.period);
    if (!name) {
      return;
    }

    optionMap.set(name, {
      id: term.id,
      name,
      academicYear: Number(term.academicYear || term.academic_year || 0) || undefined,
      sortOrder: Number(term.sortOrder ?? term.sort_order ?? index),
    });
  });

  (classes || []).forEach((classItem, index) => {
    const period = text(classItem?.period);
    if (!period || optionMap.has(period)) {
      return;
    }

    optionMap.set(period, { name: period, sortOrder: index + optionMap.size });
  });

  return [...optionMap.values()].sort((left, right) => {
    const yearGap = Number(right.academicYear || 0) - Number(left.academicYear || 0);
    if (yearGap !== 0) {
      return yearGap;
    }

    return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
  });
}

function buildGradeOptions() {
  return ['고3', '고2', '고1', '중3', '중2', '중1', '초6'];
}

function buildClassProgressRow(classItem, textbooks = []) {
  const normalized = normalizeSchedulePlan(classItem.schedulePlan || classItem.schedule_plan || null, {
    className: classItem.className || classItem.name || '',
    subject: classItem.subject || '',
    schedule: classItem.schedule || '',
    startDate: classItem.startDate || classItem.start_date || '',
    endDate: classItem.endDate || classItem.end_date || '',
    textbookIds: classItem.textbookIds || [],
    textbooks,
  });
  const calculated = calculateSchedulePlan(normalized);

  const activeSessions = (calculated.sessions || []).filter(
    (session) => session.scheduleState !== 'exception' && session.scheduleState !== 'tbd',
  );
  const totalSessions = activeSessions.length;
  const completedSessions = activeSessions.filter(
    (session) => session.progressStatus === 'done',
  ).length;
  const updatedSessions = activeSessions.filter(
    (session) => session.progressStatus !== 'pending',
  ).length;
  const delayedSessions = Math.max(totalSessions - updatedSessions, 0);

  return {
    classItem,
    totalSessions,
    completedSessions,
    updatedSessions,
    delayedSessions,
    textbookCount: normalized.textbooks.length,
    lastUpdatedAt: getLastUpdatedAt(normalized),
    teacherNames: splitTeacherList(classItem.teacher || ''),
  };
}

function buildStatusTone(row) {
  if (row.totalSessions === 0) {
    return { type: 'gray', label: '계획 전' };
  }
  if (row.delayedSessions > 0) {
    return { type: 'amber', label: `${row.delayedSessions}회 대기` };
  }
  if (row.completedSessions === row.totalSessions) {
    return { type: 'green', label: '계획 완료' };
  }
  return { type: 'blue', label: '진행 중' };
}

export default function CurriculumProgressWorkspace({ data = {}, dataService }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [classOverrides, setClassOverrides] = useState({});
  const [activeClassId, setActiveClassId] = useState('');
  const [modalMode, setModalMode] = useState('readonly');

  const classes = data?.classes || [];
  const textbooks = data?.textbooks || [];
  const classTerms = data?.classTerms || [];
  const teacherCatalogs = data?.teacherCatalogs || [];
  const classroomCatalogs = data?.classroomCatalogs || [];

  const teacherMaster = useMemo(
    () => buildTeacherMaster(teacherCatalogs, classes),
    [classes, teacherCatalogs],
  );
  const classroomMaster = useMemo(
    () => buildClassroomMaster(classroomCatalogs, classes),
    [classes, classroomCatalogs],
  );

  const subjectOptions = useMemo(
    () =>
      getResourceSubjectOptions([...teacherMaster, ...classroomMaster], classes).filter(Boolean),
    [classes, classroomMaster, teacherMaster],
  );
  const gradeOptions = useMemo(() => buildGradeOptions(), []);
  const termOptions = useMemo(() => buildTermOptions(classes, classTerms), [classes, classTerms]);

  const teacherOptions = useMemo(
    () => filterResourceOptionsBySubjects(teacherMaster, selectedSubject ? [selectedSubject] : []),
    [selectedSubject, teacherMaster],
  );

  useEffect(() => {
    setSelectedTeacher((current) => (teacherOptions.includes(current) ? current : ''));
  }, [teacherOptions]);

  const subjectItems = useMemo(
    () =>
      subjectOptions.map((subject) => ({
        value: subject,
        label: subject,
        ariaLabel: `${subject} 선택`,
      })),
    [subjectOptions],
  );

  const gradeItems = useMemo(
    () =>
      gradeOptions.map((grade) => ({
        value: grade,
        label: grade,
        ariaLabel: `${grade} 선택`,
      })),
    [gradeOptions],
  );

  const teacherItems = useMemo(() => {
    if (teacherOptions.length === 0) {
      return [
        {
          value: '__empty__',
          label: '선생님 없음',
          ariaLabel: '선생님 없음',
          disabled: true,
        },
      ];
    }

    return teacherOptions.map((teacher) => ({
      value: teacher,
      label: teacher,
      ariaLabel: `${teacher} 선택`,
    }));
  }, [teacherOptions]);

  const rows = useMemo(
    () =>
      classes.map((classItem) => {
        const override = classOverrides[classItem.id];
        const nextClassItem = override ? { ...classItem, ...override } : classItem;
        return buildClassProgressRow(nextClassItem, textbooks);
      }),
    [classOverrides, classes, textbooks],
  );

  const filteredRows = useMemo(() => {
    const keyword = text(searchQuery).toLowerCase();

    return rows.filter((row) => {
      if (selectedTerm && text(row.classItem.period) !== selectedTerm) {
        return false;
      }
      if (selectedSubject && text(row.classItem.subject) !== selectedSubject) {
        return false;
      }
      if (selectedGrade && text(row.classItem.grade) !== selectedGrade) {
        return false;
      }
      if (selectedTeacher) {
        const teacherSet = new Set(row.teacherNames);
        if (!teacherSet.has(selectedTeacher)) {
          return false;
        }
      }
      if (!keyword) {
        return true;
      }

      const haystack = [
        row.classItem.className,
        row.classItem.name,
        row.classItem.subject,
        row.classItem.grade,
        row.classItem.teacher,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [rows, searchQuery, selectedTerm, selectedSubject, selectedGrade, selectedTeacher]);

  const activeRow = useMemo(
    () => rows.find((row) => row.classItem.id === activeClassId) || null,
    [activeClassId, rows],
  );

  const handleOpenModal = (classId, nextMode) => {
    setActiveClassId(classId);
    setModalMode(nextMode);
  };

  const handleSaveDraft = async ({ classPatch, schedulePlan }) => {
    if (!activeRow) {
      return;
    }

    const classItem = activeRow.classItem;
    const mergedClass = {
      ...classItem,
      subject: classPatch.subject,
      className: classPatch.className,
      textbookIds: classPatch.textbookIds,
    };
    const savedPlan = buildSchedulePlanForSave(schedulePlan, mergedClass);
    const nextClassItem = {
      ...mergedClass,
      schedulePlan: savedPlan,
    };

    await dataService?.updateClass?.(classItem.id, {
      ...nextClassItem,
    });

    setClassOverrides((current) => ({
      ...current,
      [classItem.id]: nextClassItem,
    }));
  };

  return (
    <div
      className="view-container curriculum-progress-shell"
      style={{ padding: '12px 0 24px', display: 'grid', gap: 16 }}
    >
      <div className="management-pane-shell curriculum-progress-pane">
        <div className="management-top-shell">
          <ManagementCommandBar
            testId="curriculum-progress-command-bar"
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="수업명, 과목, 선생님 검색"
            filtersClassName="curriculum-progress-command-bar__filters"
            filtersContent={
              <>
                <div className="management-command-bar__filter management-command-bar__filter--term">
                  <CheckboxMenu
                    value={selectedTerm ? [selectedTerm] : []}
                    options={termOptions.map((term) => ({
                      value: term.name,
                      label: [term.academicYear, term.name].filter(Boolean).join(' '),
                    }))}
                    onChange={(nextValues) => setSelectedTerm(nextValues[0] || '')}
                    placeholder="전체 학기"
                    clearLabel="전체 학기"
                    clearDescription="전체 학기를 기준으로 수업 계획을 확인합니다."
                    label="학기 필터"
                    selectionMode="single"
                    showCountMeta={false}
                    className="management-command-bar__menu"
                  />
                </div>

                <div className="management-command-bar__filter management-command-bar__filter--subject">
                  <SegmentedControl
                    value={selectedSubject}
                    onValueChange={(nextValue) =>
                      setSelectedSubject((current) => (current === nextValue ? '' : nextValue))
                    }
                    items={subjectItems}
                    size="small"
                    alignment="fixed"
                    selectionMode="single"
                    className="management-command-bar__segmented management-command-bar__segmented-subject"
                  />
                </div>

                <div className="management-command-bar__filter management-command-bar__filter--grade">
                  <SegmentedControl
                    value={selectedGrade}
                    onValueChange={(nextValue) =>
                      setSelectedGrade((current) => (current === nextValue ? '' : nextValue))
                    }
                    items={gradeItems}
                    size="small"
                    alignment="fixed"
                    selectionMode="single"
                    showArrowButtons={false}
                    className="management-command-bar__segmented management-command-bar__segmented-grade"
                  />
                </div>

                <div className="management-command-bar__filter management-command-bar__filter--teacher">
                  <SegmentedControl
                    value={selectedTeacher}
                    onValueChange={(nextValue) =>
                      setSelectedTeacher((current) => (current === nextValue ? '' : nextValue))
                    }
                    items={teacherItems}
                    size="small"
                    alignment="fluid"
                    selectionMode="single"
                    className="management-command-bar__segmented management-command-bar__segmented-teacher"
                  />
                </div>
              </>
            }
          />
        </div>

        {filteredRows.length === 0 ? (
          <section className="workspace-surface" style={{ padding: 24 }}>
            <StateView
              center
              icon={<ClipboardList size={28} aria-hidden="true" />}
              title="표시할 수업이 없습니다."
              description="검색어나 필터를 바꾸고 다시 확인해 주세요."
            />
          </section>
        ) : (
          <section className="curriculum-progress-results">
            {filteredRows.map((row, index) => {
              const statusTone = buildStatusTone(row);
              return (
                <article key={row.classItem.id} className="curriculum-progress-entry">
                  <div className="curriculum-progress-entry__card">
                    <PublicLandingCard
                      rank={index + 1}
                      classItem={row.classItem}
                      onOpenDetails={() => handleOpenModal(row.classItem.id, 'readonly')}
                      onTogglePlanner={() => handleOpenModal(row.classItem.id, 'builder')}
                      plannerActionLabel="수업 설계"
                      plannerSelectedActionLabel="수업 설계"
                    />
                  </div>

                  <aside className="curriculum-progress-entry__status">
                    <div className="curriculum-progress-entry__status-body">
                      <div className="curriculum-progress-entry__badges">
                        <Badge size="small" type="blue" badgeStyle="weak">
                          {row.textbookCount}권 교재
                        </Badge>
                        <Badge size="small" type="teal" badgeStyle="weak">
                          실진도 {row.completedSessions}회
                        </Badge>
                        <Badge size="small" type={statusTone.type} badgeStyle="weak">
                          {statusTone.label}
                        </Badge>
                      </div>

                      <div className="curriculum-progress-entry__metrics">
                        <div className="curriculum-progress-entry__metric">
                          <span>입력 현황</span>
                          <strong>{row.updatedSessions}/{row.totalSessions}회</strong>
                        </div>
                        <div className="curriculum-progress-entry__metric">
                          <span>생성 회차</span>
                          <strong>{row.totalSessions}회</strong>
                        </div>
                        <div className="curriculum-progress-entry__metric">
                          <span>최종 업데이트</span>
                          <strong>{formatDateText(row.lastUpdatedAt)}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="curriculum-progress-entry__status-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleOpenModal(row.classItem.id, 'builder')}
                      >
                        수업 설계
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleOpenModal(row.classItem.id, 'checklist')}
                      >
                        진도 체크
                      </button>
                    </div>
                  </aside>
                </article>
              );
            })}
          </section>
        )}
      </div>

      <ClassSchedulePlanModal
        open={Boolean(activeRow)}
        editable={modalMode !== 'readonly'}
        mode={modalMode}
        classItem={activeRow?.classItem || null}
        plan={activeRow?.classItem?.schedulePlan || activeRow?.classItem?.schedule_plan || null}
        textbooksCatalog={textbooks}
        onSaveDraft={modalMode === 'readonly' ? undefined : handleSaveDraft}
        onClose={() => {
          setActiveClassId('');
          setModalMode('readonly');
        }}
      />
    </div>
  );
}
