import { CheckboxMenu, SegmentedControl, Tab, TextButton } from './tds';

const LABEL_ALL = '전체';
const LABEL_CLEAR = '초기화';
const LABEL_NO_OPTIONS = '선택 가능한 항목이 없습니다.';
const LABEL_CURRENT_TERM = '현재 학기';
const LABEL_TERM = '학기';
const LABEL_SELECTED_SUFFIX = '개 선택';
const LABEL_SUBJECT = '과목';
const LABEL_GRADE = '학년';
const LABEL_TEACHER = '선생님';
const LABEL_CLASSROOM = '강의실';

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getMultiSelectionSummary(selectedValues) {
  return selectedValues.length > 0 ? `${selectedValues.length}${LABEL_SELECTED_SUFFIX}` : LABEL_ALL;
}

function getSingleSelectionSummary(selectedValue) {
  return selectedValue || LABEL_ALL;
}

function getTermOptionValue(term) {
  return typeof term === 'string' ? term : term?.name || '';
}

function getTermOptionLabel(term) {
  if (typeof term === 'string') {
    return term;
  }
  if (!term) {
    return '';
  }

  const safeName = String(term.name || '').trim();
  if (term.academicYear && safeName && !safeName.includes(String(term.academicYear))) {
    return `${term.academicYear}년 ${safeName}`;
  }

  return safeName;
}

function FilterSection({ label, summary, onClear, children, className = '' }) {
  return (
    <section
      className={['timetable-unified-filter-section', className].filter(Boolean).join(' ')}
    >
      <div className="timetable-unified-filter-section-head">
        <div className="timetable-unified-filter-section-label-row">
          <div className="timetable-unified-filter-section-label">{label}</div>
          {summary ? (
            <div className="timetable-unified-filter-section-count">{summary}</div>
          ) : null}
        </div>
        {onClear ? (
          <TextButton
            className="timetable-unified-filter-clear"
            typography="t7"
            onPress={onClear}
          >
            {LABEL_CLEAR}
          </TextButton>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function TimetableUnifiedFilterPanel({
  compact = false,
  filters,
  termOptions = [],
  subjectOptions = [],
  gradeOptions = [],
  teacherOptions = [],
  classroomOptions = [],
  currentTermLabel = '',
  onChange,
  onReset = null,
  variant = 'default',
}) {
  const safeFilters = filters || {};
  const selectedTerm = safeFilters.term || '';
  const selectedSubjects = normalizeArray(safeFilters.subject);
  const selectedGrades = normalizeArray(safeFilters.grade);
  const selectedTeachers = normalizeArray(safeFilters.teacher);
  const selectedClassrooms = normalizeArray(safeFilters.classroom);
  const selectedSubject = selectedSubjects[0] || '';
  const selectedGrade = selectedGrades[0] || '';
  const isTdmTimetableMenu = variant === 'timetable-menu';
  const hasAnyFilter =
    Boolean(selectedTerm) ||
    selectedSubjects.length > 0 ||
    selectedGrades.length > 0 ||
    selectedTeachers.length > 0 ||
    selectedClassrooms.length > 0;

  const termMenuOptions = termOptions
    .map((term) => ({
      value: getTermOptionValue(term),
      label: getTermOptionLabel(term),
    }))
    .filter((option) => option.value && option.label);

  const subjectTabItems = subjectOptions.map((subject) => ({
    value: subject,
    label: subject,
    className: 'timetable-unified-filter-tab-item',
    testId: `timetable-subject-tab-${subject}`,
  }));

  const gradeTabItems = gradeOptions.map((grade) => ({
    value: grade,
    label: grade,
    className: 'timetable-unified-filter-tab-item timetable-unified-filter-tab-item-grade',
    testId: `timetable-grade-tab-${grade}`,
  }));

  const subjectSegmentItems = subjectOptions.map((subject) => ({
    value: subject,
    label: subject,
    testId: `timetable-subject-segment-${subject}`,
  }));

  const gradeSegmentItems = gradeOptions.map((grade) => ({
    value: grade,
    label: grade,
    testId: `timetable-grade-segment-${grade}`,
  }));

  const handleSubjectChange = (nextValue) => {
    onChange?.('subject', selectedSubject === nextValue ? [] : [nextValue]);
  };

  const handleGradeChange = (nextValue) => {
    onChange?.('grade', selectedGrade === nextValue ? [] : [nextValue]);
  };

  return (
    <div
      className={[
        'timetable-unified-filter',
        compact ? 'is-compact' : '',
        isTdmTimetableMenu ? 'is-timetable-menu' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="timetable-unified-filter"
    >
      {isTdmTimetableMenu ? (
        <div className="timetable-unified-filter-toolbar">
          <div className="timetable-unified-filter-toolbar-spacer" />
          {hasAnyFilter && onReset ? (
            <TextButton
              className="timetable-unified-filter-toolbar-action"
              typography="t6"
              onPress={onReset}
            >
              초기화
            </TextButton>
          ) : null}
        </div>
      ) : null}

      <div className="timetable-unified-filter-grid">
        <FilterSection
          label={LABEL_TERM}
          summary={selectedTerm || currentTermLabel || `${LABEL_ALL} ${LABEL_TERM}`}
          onClear={selectedTerm ? () => onChange('term', '') : null}
          className="timetable-unified-filter-section-term"
        >
          <div className="timetable-unified-filter-chip-grid timetable-unified-filter-checkbox-wrap">
            <CheckboxMenu
              value={selectedTerm ? [selectedTerm] : []}
              options={termMenuOptions}
              onChange={(nextValues) => onChange('term', nextValues[0] || '')}
              placeholder={
                currentTermLabel
                  ? `${LABEL_CURRENT_TERM} (${currentTermLabel})`
                  : `${LABEL_ALL} ${LABEL_TERM}`
              }
              clearLabel={`${LABEL_ALL} ${LABEL_TERM}`}
              clearDescription="전체 학기를 기준으로 확인합니다."
              label="학기 필터"
              className="timetable-unified-filter-menu timetable-unified-filter-menu-term"
              showCountMeta={false}
              selectionMode="single"
            />
          </div>
        </FilterSection>

        <FilterSection
          label={LABEL_SUBJECT}
          summary={getSingleSelectionSummary(selectedSubject)}
          onClear={selectedSubject ? () => onChange('subject', []) : null}
          className="timetable-unified-filter-section-subject"
        >
          {isTdmTimetableMenu ? (
            subjectSegmentItems.length > 0 ? (
              <SegmentedControl
                value={selectedSubject}
                onValueChange={handleSubjectChange}
                items={subjectSegmentItems}
                size="large"
                alignment="fixed"
                className="timetable-unified-filter-segmented timetable-unified-filter-segmented-subject"
              />
            ) : (
              <div className="timetable-unified-filter-empty">{LABEL_NO_OPTIONS}</div>
            )
          ) : subjectTabItems.length > 0 ? (
            <Tab
              size="large"
              value={selectedSubject}
              onChange={(nextValue) =>
                onChange('subject', selectedSubject === nextValue ? [] : [nextValue])
              }
              items={subjectTabItems}
              className="timetable-unified-filter-tabs timetable-unified-filter-tabs-subject"
              data-testid="timetable-subject-tabs"
            />
          ) : (
            <div className="timetable-unified-filter-empty">{LABEL_NO_OPTIONS}</div>
          )}
        </FilterSection>

        <FilterSection
          label={LABEL_GRADE}
          summary={getSingleSelectionSummary(selectedGrade)}
          onClear={selectedGrade ? () => onChange('grade', []) : null}
          className="timetable-unified-filter-section-grade"
        >
          {isTdmTimetableMenu ? (
            gradeSegmentItems.length > 0 ? (
              <SegmentedControl
                value={selectedGrade}
                onValueChange={handleGradeChange}
                items={gradeSegmentItems}
                size="small"
                alignment="fluid"
                className="timetable-unified-filter-segmented timetable-unified-filter-segmented-grade"
                showArrowButtons={!compact}
              />
            ) : (
              <div className="timetable-unified-filter-empty">{LABEL_NO_OPTIONS}</div>
            )
          ) : gradeTabItems.length > 0 ? (
            <Tab
              size="small"
              fluid
              value={selectedGrade}
              onChange={(nextValue) =>
                onChange('grade', selectedGrade === nextValue ? [] : [nextValue])
              }
              items={gradeTabItems}
              className="timetable-unified-filter-tabs timetable-unified-filter-tabs-grade"
              data-testid="timetable-grade-tabs"
            />
          ) : (
            <div className="timetable-unified-filter-empty">{LABEL_NO_OPTIONS}</div>
          )}
        </FilterSection>

        <FilterSection
          label={LABEL_TEACHER}
          summary={getMultiSelectionSummary(selectedTeachers)}
          onClear={selectedTeachers.length > 0 ? () => onChange('teacher', []) : null}
          className="timetable-unified-filter-section-teacher"
        >
          <div className="timetable-unified-filter-chip-grid timetable-unified-filter-checkbox-wrap">
            <CheckboxMenu
              value={selectedTeachers}
              options={teacherOptions.map((teacher) => ({ value: teacher, label: teacher }))}
              onChange={(nextValues) => onChange('teacher', nextValues)}
              placeholder={`${LABEL_ALL} ${LABEL_TEACHER}`}
              clearLabel={`${LABEL_ALL} ${LABEL_TEACHER}`}
              clearDescription="전체 선생님을 기준으로 확인합니다."
              label="선생님 필터"
              className="timetable-unified-filter-menu timetable-unified-filter-menu-teacher"
              maxPreview={2}
            />
          </div>
        </FilterSection>

        <FilterSection
          label={LABEL_CLASSROOM}
          summary={getMultiSelectionSummary(selectedClassrooms)}
          onClear={selectedClassrooms.length > 0 ? () => onChange('classroom', []) : null}
          className="timetable-unified-filter-section-classroom"
        >
          <div className="timetable-unified-filter-chip-grid timetable-unified-filter-checkbox-wrap">
            <CheckboxMenu
              value={selectedClassrooms}
              options={classroomOptions.map((classroom) => ({ value: classroom, label: classroom }))}
              onChange={(nextValues) => onChange('classroom', nextValues)}
              placeholder={`${LABEL_ALL} ${LABEL_CLASSROOM}`}
              clearLabel={`${LABEL_ALL} ${LABEL_CLASSROOM}`}
              clearDescription="전체 강의실을 기준으로 확인합니다."
              label="강의실 필터"
              className="timetable-unified-filter-menu timetable-unified-filter-menu-classroom"
              maxPreview={2}
            />
          </div>
        </FilterSection>
      </div>
    </div>
  );
}
