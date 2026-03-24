import { ArrowDown, ArrowUp } from 'lucide-react';
import { CLASS_COLUMN_LABELS } from './utils';

function renderFilterControl({ column, value, onChange, options }) {
  if (!column.filterKind) {
    return null;
  }

  if (column.filterKind === 'single-select') {
    return (
      <select
        className="styled-input"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">전체</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (column.filterKind === 'multi-select') {
    return (
      <select
        className="styled-input management-filter-select-multi"
        multiple
        value={value || []}
        onChange={(event) =>
          onChange(Array.from(event.target.selectedOptions).map((option) => option.value))
        }
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (column.filterKind === 'number-range' || column.filterKind === 'date-range') {
    return (
      <div className="management-filter-range">
        <input
          type={column.filterKind === 'date-range' ? 'date' : 'number'}
          className="styled-input"
          placeholder="최소"
          value={value?.min || ''}
          onChange={(event) => onChange({ ...value, min: event.target.value })}
        />
        <input
          type={column.filterKind === 'date-range' ? 'date' : 'number'}
          className="styled-input"
          placeholder="최대"
          value={value?.max || ''}
          onChange={(event) => onChange({ ...value, max: event.target.value })}
        />
      </div>
    );
  }

  return (
    <input
      type="text"
      className="styled-input"
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={`${column.label} 검색`}
    />
  );
}

export default function ManagementViewSettingsPanel({
  tableControls,
  quickFilterOptions = {},
  excludeFilterKeys = [],
}) {
  if (!tableControls) {
    return null;
  }

  const excludeSet = new Set(excludeFilterKeys);
  const floatingFilterColumns = tableControls.columns.filter(
    (column) => column.filterKind && !excludeSet.has(column.key),
  );
  const activeFilterCount = tableControls.columns.reduce((countValue, column) => {
    const value = tableControls.filters[column.key];
    if (Array.isArray(value)) {
      return countValue + (value.length > 0 ? 1 : 0);
    }
    if (value && typeof value === 'object') {
      return countValue + (value.min || value.max ? 1 : 0);
    }
    return countValue + (String(value || '').trim() ? 1 : 0);
  }, 0);

  return (
    <div className="management-panel-stack management-view-settings">
      <div className="management-panel-section">
        <div className="management-panel-section-head">
          <div className="management-panel-section-title">정렬 · 그룹</div>
          <button
            type="button"
            className="management-inline-action"
            onClick={tableControls.clearAllFilters}
          >
            필터 초기화
          </button>
        </div>

        <div className="management-sort-grid">
          <select
            className="styled-input"
            value={tableControls.sortState.key}
            onChange={(event) =>
              tableControls.setSort(event.target.value, tableControls.sortState.direction)
            }
          >
            {tableControls.columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="management-square-button"
            onClick={() =>
              tableControls.setSort(
                tableControls.sortState.key,
                tableControls.sortState.direction === 'asc' ? 'desc' : 'asc',
              )
            }
            aria-label="정렬 방향 전환"
          >
            {tableControls.sortState.direction === 'asc' ? (
              <ArrowUp size={16} />
            ) : (
              <ArrowDown size={16} />
            )}
          </button>
        </div>

        <div className="management-group-grid">
          <select
            className="styled-input"
            value={tableControls.grouping?.[0] || ''}
            onChange={(event) => tableControls.setGroupingLevel(0, event.target.value)}
          >
            <option value="">그룹 1 없음</option>
            {tableControls.columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
          <select
            className="styled-input"
            value={tableControls.grouping?.[1] || ''}
            onChange={(event) => tableControls.setGroupingLevel(1, event.target.value)}
          >
            <option value="">그룹 2 없음</option>
            {tableControls.columns
              .filter((column) => column.key !== tableControls.grouping?.[0])
              .map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
          </select>
        </div>

        {activeFilterCount > 0 ? (
          <div className="management-panel-caption">
            {activeFilterCount}개의 필터가 적용 중입니다.
          </div>
        ) : null}
      </div>

      <div className="management-panel-section">
        <div className="management-panel-section-head">
          <div className="management-panel-section-title">컬럼 표시</div>
          <button
            type="button"
            className="management-inline-action"
            onClick={tableControls.resetColumnOrder}
          >
            순서 초기화
          </button>
        </div>

        <div className="management-column-list">
          {tableControls.columns.map((column) => (
            <div key={column.key} className="management-column-item">
              <label className="management-column-toggle">
                <input
                  type="checkbox"
                  checked={tableControls.visibleMap[column.key] !== false}
                  onChange={() => tableControls.toggleColumnVisibility(column.key)}
                />
                <span>{CLASS_COLUMN_LABELS[column.key] || column.label || column.key}</span>
              </label>
              <div className="management-column-actions">
                <button
                  type="button"
                  className="management-square-button"
                  onClick={() => tableControls.moveColumn(column.key, 'up')}
                  aria-label={`${column.label} 위로 이동`}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="management-square-button"
                  onClick={() => tableControls.moveColumn(column.key, 'down')}
                  aria-label={`${column.label} 아래로 이동`}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {floatingFilterColumns.length > 0 ? (
        <div className="management-panel-section">
          <div className="management-panel-section-title">고급 필터</div>
          <div className="management-floating-filter-list">
            {floatingFilterColumns.map((column) => (
              <div key={column.key} className="management-floating-filter-field">
                <label className="management-floating-filter-label">{column.label}</label>
                {renderFilterControl({
                  column,
                  value: tableControls.filters[column.key],
                  onChange: (nextValue) => tableControls.setFilterValue(column.key, nextValue),
                  options:
                    quickFilterOptions[column.key] ||
                    tableControls.filterOptions[column.key] ||
                    [],
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
