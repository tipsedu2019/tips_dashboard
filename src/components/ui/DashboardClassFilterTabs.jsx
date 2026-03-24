import { useMemo } from 'react';

const DEFAULT_SUBJECT_OPTIONS = ['\uC601\uC5B4', '\uC218\uD559'];

export default function DashboardClassFilterTabs({
  subjectOptions = DEFAULT_SUBJECT_OPTIONS,
  gradeOptions = [],
  activeSubjects = [],
  activeGrades = [],
  onSubjectToggle,
  onGradeToggle,
}) {
  const subjects = useMemo(
    () => (subjectOptions.length > 0 ? subjectOptions : DEFAULT_SUBJECT_OPTIONS),
    [subjectOptions]
  );

  const handleSubjectClick = (value) => {
    if (!onSubjectToggle) return;

    const isActive = activeSubjects.includes(value);
    if (isActive) {
      onSubjectToggle(activeSubjects.filter((subject) => subject !== value));
      return;
    }

    onSubjectToggle([...activeSubjects, value]);
  };

  const handleGradeClick = (value) => {
    if (!onGradeToggle) return;

    const isActive = activeGrades.includes(value);
    if (isActive) {
      onGradeToggle(activeGrades.filter((grade) => grade !== value));
      return;
    }

    onGradeToggle([...activeGrades, value]);
  };

  return (
    <div className="dashboard-class-filter-tabs tds-stack tds-stack--sm" data-testid="dashboard-class-filter-tabs">
      <div className="dashboard-class-filter-row tds-cluster">
        {subjects.map((subject) => {
          const isActive = activeSubjects.includes(subject);

          return (
            <button
              key={subject}
              type="button"
              className={`dashboard-class-filter-chip ${isActive ? 'is-active' : ''}`}
              aria-pressed={isActive}
              onClick={() => handleSubjectClick(subject)}
            >
              {subject}
            </button>
          );
        })}
      </div>

      {gradeOptions.length > 0 ? (
        <div className="dashboard-class-filter-row tds-cluster">
          {gradeOptions.map((grade) => {
            const isActive = activeGrades.includes(grade);

            return (
              <button
                key={grade}
                type="button"
                className={`dashboard-class-filter-chip is-grade ${isActive ? 'is-active' : ''}`}
                aria-pressed={isActive}
                onClick={() => handleGradeClick(grade)}
              >
                {grade}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
