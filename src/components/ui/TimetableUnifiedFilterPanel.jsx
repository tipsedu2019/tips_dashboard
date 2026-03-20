const LABEL_ALL = '\uC804\uCCB4';
const LABEL_CLEAR = '\uCD08\uAE30\uD654';
const LABEL_NO_OPTIONS = '\uC120\uD0DD \uAC00\uB2A5\uD55C \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.';
const LABEL_CURRENT_TERM = '\uD604\uC7AC \uD559\uAE30';
const LABEL_TERM = '\uD559\uAE30';
const LABEL_SELECTED_SUFFIX = '\uAC1C \uC120\uD0DD';
const LABEL_SUBJECT = '\uACFC\uBAA9';
const LABEL_GRADE = '\uD559\uB144';
const LABEL_TEACHER = '\uC120\uC0DD\uB2D8';
const LABEL_CLASSROOM = '\uAC15\uC758\uC2E4';

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getSelectionSummary(label, selectedValues) {
  return selectedValues.length > 0
    ? `${selectedValues.length}${LABEL_SELECTED_SUFFIX}`
    : '';
}

function FilterChipGroup({
  label,
  filterKey,
  options = [],
  value = [],
  onToggle,
  compact = false,
  dense = false,
  scrollable = false,
}) {
  const selectedValues = normalizeArray(value);
  const selectionSummary = getSelectionSummary(label, selectedValues);
  const classNames = [
    'timetable-unified-filter-section',
    `timetable-unified-filter-section-${filterKey}`,
    scrollable ? 'is-scrollable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classNames}>
      <div className="timetable-unified-filter-section-head">
        <div className="timetable-unified-filter-section-label-row">
          <div className="timetable-unified-filter-section-label">{label}</div>
          {selectionSummary ? (
            <div className="timetable-unified-filter-section-count">
              {selectionSummary}
            </div>
          ) : null}
        </div>
        {selectedValues.length > 0 ? (
          <button
            type="button"
            className="timetable-unified-filter-clear"
            onClick={() => onToggle(filterKey, [])}
          >
            {LABEL_CLEAR}
          </button>
        ) : null}
      </div>

      <div
        className={[
          'timetable-unified-filter-chip-grid',
          compact ? 'is-compact' : '',
          dense ? 'is-dense' : '',
          scrollable ? 'is-scrollable' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {options.length > 0 ? (
          options.map((option) => {
            const active = selectedValues.includes(option);
            const next = active
              ? selectedValues.filter((item) => item !== option)
              : [...selectedValues, option];

            return (
              <button
                key={option}
                type="button"
                className={`chip-button timetable-unified-chip ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => onToggle(filterKey, next)}
              >
                {option}
              </button>
            );
          })
        ) : (
          <div className="timetable-unified-filter-empty">{LABEL_NO_OPTIONS}</div>
        )}
      </div>
    </section>
  );
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

  const safeName = term.name || '';
  if (term.academicYear && !String(safeName).includes(String(term.academicYear))) {
    return `${term.academicYear}\uB144 ${safeName}`;
  }

  return safeName;
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
}) {
  const safeFilters = filters || {};
  const selectedTerm = safeFilters.term || '';

  return (
    <div
      className={`timetable-unified-filter ${compact ? 'is-compact' : ''}`}
      data-testid="timetable-unified-filter"
    >
      <div className="timetable-unified-filter-grid">
        <section className="timetable-unified-filter-section timetable-unified-filter-section-term">
          <div className="timetable-unified-filter-section-head">
            <div className="timetable-unified-filter-section-label-row">
              <div className="timetable-unified-filter-section-label">{LABEL_TERM}</div>
              <div className="timetable-unified-filter-section-count">
                {selectedTerm || currentTermLabel || `${LABEL_ALL} ${LABEL_TERM}`}
              </div>
            </div>
            {selectedTerm ? (
              <button
                type="button"
                className="timetable-unified-filter-clear"
                onClick={() => onChange('term', '')}
              >
                {LABEL_CLEAR}
              </button>
            ) : null}
          </div>

          <div className="timetable-unified-filter-term-row">
            <select
              className="styled-input timetable-unified-term-select"
              data-testid="timetable-term-select"
              value={selectedTerm}
              onChange={(event) => onChange('term', event.target.value)}
            >
              <option value="">
                {currentTermLabel
                  ? `${LABEL_CURRENT_TERM} (${currentTermLabel})`
                  : `${LABEL_ALL} ${LABEL_TERM}`}
              </option>
              {termOptions.map((term) => (
                <option key={getTermOptionValue(term)} value={getTermOptionValue(term)}>
                  {getTermOptionLabel(term)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <FilterChipGroup
          label={LABEL_SUBJECT}
          filterKey="subject"
          options={subjectOptions}
          value={safeFilters.subject}
          onToggle={onChange}
          compact={compact}
        />
        <FilterChipGroup
          label={LABEL_GRADE}
          filterKey="grade"
          options={gradeOptions}
          value={safeFilters.grade}
          onToggle={onChange}
          compact={compact}
          dense
        />
        <FilterChipGroup
          label={LABEL_TEACHER}
          filterKey="teacher"
          options={teacherOptions}
          value={safeFilters.teacher}
          onToggle={onChange}
          compact={compact}
          dense
          scrollable
        />
        <FilterChipGroup
          label={LABEL_CLASSROOM}
          filterKey="classroom"
          options={classroomOptions}
          value={safeFilters.classroom}
          onToggle={onChange}
          compact={compact}
          dense
          scrollable
        />
      </div>
    </div>
  );
}
