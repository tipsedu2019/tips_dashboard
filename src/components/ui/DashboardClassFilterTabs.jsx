import { useMemo } from 'react';

const DEFAULT_SUBJECT_OPTIONS = ['영어', '수학'];

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
      onSubjectToggle(activeSubjects.filter((s) => s !== value));
    } else {
      onSubjectToggle([...activeSubjects, value]);
    }
  };

  const handleGradeClick = (value) => {
    if (!onGradeToggle) return;
    const isActive = activeGrades.includes(value);
    if (isActive) {
      onGradeToggle(activeGrades.filter((g) => g !== value));
    } else {
      onGradeToggle([...activeGrades, value]);
    }
  };

  return (
    <div className="dashboard-class-filter-tabs" data-testid="dashboard-class-filter-tabs">
      <div className="dashboard-class-filter-row">
        {subjects.map((subject) => (
          <button
            key={subject}
            type="button"
            className={`dashboard-class-filter-chip ${activeSubjects.includes(subject) ? 'is-active' : ''}`}
            onClick={() => handleSubjectClick(subject)}
          >
            {subject}
          </button>
        ))}
      </div>

      {gradeOptions.length > 0 && (
        <div className="dashboard-class-filter-row">
          {gradeOptions.map((grade) => (
            <button
              key={grade}
              type="button"
              className={`dashboard-class-filter-chip is-grade ${activeGrades.includes(grade) ? 'is-active' : ''}`}
              onClick={() => handleGradeClick(grade)}
            >
              {grade}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
