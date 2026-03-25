import ManagementCommandBar from "../data-manager/ManagementCommandBar";
import { CheckboxMenu, SegmentedControl } from "../ui/tds";

function buildSegmentItems(values = []) {
  return (values || []).map((value) => ({
    value,
    label: value,
    ariaLabel: `${value} 선택`,
  }));
}

export default function ClassScheduleToolbar({
  viewState,
  filterOptions,
  searchValue,
  onSearchChange,
  onFiltersChange,
}) {
  const subjectItems = buildSegmentItems(filterOptions.subjects);
  const gradeItems = buildSegmentItems(filterOptions.grades);
  const teacherItems = buildSegmentItems(filterOptions.teachers);

  return (
    <ManagementCommandBar
      testId="class-schedule-command-bar"
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      searchPlaceholder="수업명, 과목, 선생님 검색"
      filtersClassName="curriculum-progress-command-bar__filters class-schedule-command-bar__filters"
      filtersContent={
        <>
          <div className="management-command-bar__filter management-command-bar__filter--term">
            <CheckboxMenu
              value={viewState.filters.termId ? [viewState.filters.termId] : []}
              options={(filterOptions.terms || []).map((term) => ({
                value: term.value,
                label: term.label,
              }))}
              onChange={(nextValues) => onFiltersChange({ termId: nextValues[0] || "" })}
              placeholder="전체 학기"
              clearLabel="전체 학기"
              clearDescription="전체 학기를 기준으로 수업 일정을 봅니다."
              label="학기 필터"
              selectionMode="single"
              showCountMeta={false}
              className="management-command-bar__menu"
            />
          </div>

          <div className="management-command-bar__filter management-command-bar__filter--subject">
            <SegmentedControl
              value={viewState.filters.subject}
              onValueChange={(nextValue) =>
                onFiltersChange({
                  subject: viewState.filters.subject === nextValue ? "" : nextValue,
                })}
              items={subjectItems}
              size="small"
              alignment="fixed"
              selectionMode="single"
              className="management-command-bar__segmented management-command-bar__segmented-subject"
            />
          </div>

          <div className="management-command-bar__filter management-command-bar__filter--grade">
            <SegmentedControl
              value={viewState.filters.grade}
              onValueChange={(nextValue) =>
                onFiltersChange({
                  grade: viewState.filters.grade === nextValue ? "" : nextValue,
                })}
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
              value={viewState.filters.teacher}
              onValueChange={(nextValue) =>
                onFiltersChange({
                  teacher: viewState.filters.teacher === nextValue ? "" : nextValue,
                })}
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
  );
}
