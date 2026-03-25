import { Camera } from 'lucide-react';
import { CheckboxMenu, SegmentedControl } from './tds';

const ACTIVE_TIMETABLE_SEGMENT_STYLE = {
  background: 'var(--ui-primary)',
  color: '#ffffff',
  borderColor: 'var(--ui-primary)',
  boxShadow:
    '0 10px 24px rgba(49, 130, 246, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
};

const gridOptions = [1, 2].map((count) => ({
  value: String(count),
  label: `${count}`,
  ariaLabel: `${count}그리드 보기`,
}));

export default function TimetableTopFilterBar({
  compact = false,
  termOptions = [],
  currentTermLabel = '',
  selectedTerm = '',
  onTermChange,
  subjectOptions = [],
  selectedSubjectValues = [],
  onSubjectChange,
  axisOptions = [],
  selectedAxisValues = [],
  onAxisChange,
  axisLabel = '',
  axisAlignment = 'fluid',
  gridCount = 2,
  onGridCountChange,
  onExportImage,
}) {
  const subjectItems = subjectOptions.map((subject) => ({
    value: subject,
    label: subject,
    ariaLabel: `${subject} 선택`,
    activeStyle: ACTIVE_TIMETABLE_SEGMENT_STYLE,
  }));

  const axisItems = axisOptions.map((option) => ({
    value: option,
    label: option,
    ariaLabel: `${axisLabel || option} 선택`,
    activeStyle: ACTIVE_TIMETABLE_SEGMENT_STYLE,
  }));

  const toggleSelection = (currentValues, nextValue) => {
    const normalizedValues = Array.isArray(currentValues) ? currentValues : [];
    if (normalizedValues.includes(nextValue)) {
      return normalizedValues.filter((value) => value !== nextValue);
    }
    return [...normalizedValues, nextValue];
  };

  const handleSubjectValueChange = (nextValue) => {
    const currentValue = Array.isArray(selectedSubjectValues)
      ? selectedSubjectValues[0] || ''
      : '';
    onSubjectChange?.(currentValue === nextValue ? [] : [nextValue]);
  };

  const handleAxisValueChange = (nextValue) => {
    onAxisChange?.(toggleSelection(selectedAxisValues, nextValue));
  };

  return (
    <div
      className={['timetable-top-filter-bar', compact ? 'is-compact' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="timetable-top-filter-bar"
    >
      <div
        className="timetable-top-filter-bar__main"
        data-testid="timetable-top-filter-bar-main"
      >
        <div
          className="timetable-top-filter-bar__term"
          data-testid="timetable-top-filter-bar-term"
        >
          <CheckboxMenu
            value={selectedTerm ? [selectedTerm] : []}
            options={termOptions.map((term) => ({
              value: typeof term === 'string' ? term : term?.name || '',
              label:
                typeof term === 'string'
                  ? term
                  : [term?.academicYear, term?.name].filter(Boolean).join(' '),
            }))}
            onChange={(nextValues) => onTermChange?.(nextValues[0] || '')}
            placeholder={currentTermLabel || '학기'}
            clearLabel={currentTermLabel || '현재 학기'}
            clearDescription="현재 학기를 기준으로 시간표를 확인합니다."
            label="학기 선택"
            showCountMeta={false}
            selectionMode="single"
            className="timetable-top-filter-bar__term-menu"
          />
        </div>

        <div
          className="timetable-top-filter-bar__segment timetable-top-filter-bar__segment--subject"
          data-testid="timetable-top-filter-bar-subject"
        >
          <SegmentedControl
            value={selectedSubjectValues[0] || ''}
            onValueChange={handleSubjectValueChange}
            items={subjectItems}
            size="small"
            alignment="fixed"
            selectionMode="single"
            className="timetable-top-filter-bar__segmented timetable-top-filter-bar__segmented-subject"
            showArrowButtons={!compact}
          />
        </div>

        <div
          className="timetable-top-filter-bar__segment timetable-top-filter-bar__segment--axis"
          data-testid="timetable-top-filter-bar-axis"
        >
          <SegmentedControl
            value={selectedAxisValues}
            onValueChange={handleAxisValueChange}
            items={axisItems}
            size="small"
            alignment={axisAlignment}
            selectionMode="multiple"
            className="timetable-top-filter-bar__segmented timetable-top-filter-bar__segmented-axis"
            showArrowButtons={!compact}
          />
        </div>
      </div>

      <div
        className="timetable-top-filter-bar__slot"
        data-testid="timetable-top-filter-bar-slot"
      >
        {!compact ? (
          <div
            className="timetable-top-filter-bar__actions"
            data-testid="timetable-top-filter-bar-actions"
          >
            <SegmentedControl
              value={String(gridCount)}
              onValueChange={(nextValue) =>
                onGridCountChange?.(
                  Math.min(2, Math.max(1, Number(nextValue) || 2)),
                )
              }
              items={gridOptions}
              size="small"
              alignment="fixed"
              className="timetable-top-filter-bar__grid"
            />
            <button
              type="button"
              className="action-chip timetable-top-filter-bar__action is-icon-only"
              onClick={onExportImage}
              aria-label="현재 시간표를 PNG로 저장"
              title="현재 시간표를 PNG로 저장"
            >
              <Camera size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
