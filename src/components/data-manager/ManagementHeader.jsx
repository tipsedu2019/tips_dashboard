import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Filter, Search, Trash2 } from 'lucide-react';
import { CLASS_COLUMN_LABELS } from './utils';
import useViewport from '../../hooks/useViewport';
import BottomSheet from '../ui/BottomSheet';

function renderFilterControl({ column, value, onChange, options }) {
  if (!column.filterKind) {
    return null;
  }

  if (column.filterKind === 'single-select') {
    return (
      <select className="styled-input" value={value || ''} onChange={(event) => onChange(event.target.value)}>
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
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
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

function ToolbarAction({ action, disabled }) {
  const variantClassName = action.variant === 'primary'
    ? 'management-toolbar-action management-toolbar-action-primary'
    : 'management-toolbar-action management-toolbar-action-secondary';

  const content = (
    <>
      {action.icon}
      <span>{action.label}</span>
    </>
  );

  if (action.kind === 'file') {
    return (
      <label
        className={`${variantClassName} ${disabled ? 'is-disabled' : ''}`}
      >
        {content}
        <input
          type="file"
          accept={action.accept || '.xlsx,.xls,.csv'}
          className="management-toolbar-file-input"
          disabled={disabled}
          onChange={action.onChange}
        />
      </label>
    );
  }

  return (
    <button
      type="button"
      className={`${variantClassName} ${disabled ? 'is-disabled' : ''}`}
      onClick={action.onClick}
      disabled={disabled}
    >
      {content}
    </button>
  );
}

function QuickFilterGroup({ column, options, selectedValues, onChange }) {
  const normalizedSelected = Array.isArray(selectedValues) ? selectedValues : [];
  const allSelected = options.length > 0 && normalizedSelected.length === options.length;

  const toggleOption = (option) => {
    if (normalizedSelected.includes(option)) {
      onChange(normalizedSelected.filter((value) => value !== option));
      return;
    }
    onChange([...normalizedSelected, option]);
  };

  return (
    <div className="management-quick-filter-group" data-testid={`quick-filter-${column.key}`}>
      <div className="management-quick-filter-head">
        <div className="management-quick-filter-title">{column.label}</div>
        <button
          type="button"
          className="management-quick-filter-toggle"
          onClick={() => onChange(allSelected ? [] : options)}
        >
          {allSelected ? '전체 해제' : '전체 선택'}
        </button>
      </div>
      {options.length > 0 ? (
        <div className="management-quick-filter-chips">
          {options.map((option) => {
            const active = normalizedSelected.includes(option);
            return (
              <button
                key={option}
                type="button"
                data-testid={`quick-filter-option-${column.key}`}
                data-filter-value={option}
                className={`chip-button ${active ? 'is-active' : ''}`}
                onClick={() => toggleOption(option)}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="management-quick-filter-empty">선택한 조건에 맞는 옵션이 없습니다.</div>
      )}
    </div>
  );
}

function FloatingFilterPanel({
  tableControls,
  quickFilterOptions,
  floatingFilterColumns,
  activeFilterCount,
}) {
  return (
    <div className="management-panel-stack">
      <div className="management-panel-section">
        <div className="management-panel-section-head">
          <div className="management-panel-section-title">정렬</div>
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
            onChange={(event) => tableControls.setSort(event.target.value, tableControls.sortState.direction)}
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
                tableControls.sortState.direction === 'asc' ? 'desc' : 'asc'
              )
            }
            aria-label="정렬 방향 전환"
          >
            {tableControls.sortState.direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          </button>
        </div>
      </div>

      <div className="management-panel-section">
        <div className="management-panel-section-head">
          <div className="management-panel-section-title">그룹</div>
          <button
            type="button"
            className="management-inline-action"
            onClick={tableControls.clearGrouping}
          >
            그룹 초기화
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
          <div className="management-panel-caption">{activeFilterCount}개의 필터가 적용 중입니다.</div>
        ) : null}
      </div>

      {floatingFilterColumns.length > 0 ? (
        <div className="management-panel-section">
          <div className="management-panel-section-title">상세 필터</div>
          <div className="management-floating-filter-list">
            {floatingFilterColumns.map((column) => (
              <div key={column.key} className="management-floating-filter-field">
                <label className="management-floating-filter-label">{column.label}</label>
                {renderFilterControl({
                  column,
                  value: tableControls.filters[column.key],
                  onChange: (value) => tableControls.setFilterValue(column.key, value),
                  options: quickFilterOptions[column.key] || tableControls.filterOptions[column.key] || [],
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ColumnPanel({ tableControls }) {
  return (
    <div className="management-panel-stack">
      <div className="management-panel-section">
        <div className="management-panel-section-head">
          <div className="management-panel-section-title">표시할 컬럼</div>
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
    </div>
  );
}

export default function ManagementHeader({
  title,
  description,
  count,
  searchValue,
  onSearchChange,
  toolbarActions = [],
  selectedCount = 0,
  currentCount = 0,
  onToggleSelectAll,
  onDeleteSelected,
  onBulkUpdate,
  bulkUpdateLabel = '일괄 수정',
  isBusy = false,
  tableControls,
  searchPlaceholder = '이름, 학교, 연락처 검색',
  embedded = false,
  hideSummary = false,
  className = '',
  quickFilterKeys = [],
  quickFilterOptions = {},
  classesUnifiedFilterMode = false,
}) {
  const { isMobile } = useViewport();
  const columnSelectorRef = useRef(null);
  const filterRef = useRef(null);
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false);
  const hasOpenPanel = isColumnPanelOpen || isFilterPanelOpen || isMobileFilterSheetOpen;

  const quickFilterKeySet = useMemo(() => new Set(quickFilterKeys), [quickFilterKeys]);

  const activeFilterCount = useMemo(() => {
    if (!tableControls) {
      return 0;
    }

    return tableControls.columns.reduce((countValue, column) => {
      const value = tableControls.filters[column.key];
      if (Array.isArray(value)) {
        return countValue + (value.length > 0 ? 1 : 0);
      }
      if (value && typeof value === 'object') {
        return countValue + (value.min || value.max ? 1 : 0);
      }
      return countValue + (String(value || '').trim() ? 1 : 0);
    }, 0);
  }, [tableControls]);

  const quickFilterColumns = useMemo(() => {
    if (!tableControls) {
      return [];
    }
    const columnMap = new Map(tableControls.columns.map((column) => [column.key, column]));
    return quickFilterKeys
      .map((key) => columnMap.get(key))
      .filter((column) => column && column.filterKind === 'multi-select');
  }, [quickFilterKeys, tableControls]);

  const visibleQuickFilterColumns = useMemo(
    () => (isMobile ? quickFilterColumns.slice(0, 2) : quickFilterColumns),
    [isMobile, quickFilterColumns]
  );

  const overflowQuickFilterColumns = useMemo(
    () => (isMobile ? quickFilterColumns.slice(2) : []),
    [isMobile, quickFilterColumns]
  );

  const floatingFilterColumns = useMemo(() => {
    if (!tableControls) {
      return [];
    }
    return tableControls.columns.filter(
      (column) => column.filterKind && !quickFilterKeySet.has(column.key)
    );
  }, [quickFilterKeySet, tableControls]);

  const mobileFilterSheetColumns = useMemo(
    () => [...overflowQuickFilterColumns, ...floatingFilterColumns],
    [floatingFilterColumns, overflowQuickFilterColumns]
  );

  const selectedQuickFilterTokens = useMemo(() => {
    if (!tableControls) {
      return [];
    }

    return quickFilterColumns.flatMap((column) => {
      const selectedValues = Array.isArray(tableControls.filters[column.key])
        ? tableControls.filters[column.key]
        : [];

      return selectedValues.slice(0, 2).map((value) => `${column.label} · ${value}`);
    });
  }, [quickFilterColumns, tableControls]);

  const quickFilterOverflowCount = useMemo(() => {
    if (!tableControls) {
      return 0;
    }

    return quickFilterColumns.reduce((total, column) => {
      const selectedValues = Array.isArray(tableControls.filters[column.key])
        ? tableControls.filters[column.key]
        : [];

      return total + Math.max(0, selectedValues.length - 2);
    }, 0);
  }, [quickFilterColumns, tableControls]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!columnSelectorRef.current?.contains(event.target)) {
        setIsColumnPanelOpen(false);
      }
      if (!filterRef.current?.contains(event.target)) {
        setIsFilterPanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileFilterSheetOpen(false);
    }
  }, [isMobile]);

  const rootClassName = [
    embedded ? 'management-header-shell management-header-shell-embedded' : 'card-custom p-6 management-header-shell',
    hasOpenPanel ? 'is-layered' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName}>
      <div className={`management-header-top ${hideSummary ? 'is-compact' : ''}`}>
        {!hideSummary ? (
          <div className="management-header-copy">
            <h3 className="management-header-title">{title}</h3>
            <div className="management-header-count">현재 {count}개 항목</div>
            {description ? (
              <div className="management-header-description">{description}</div>
            ) : null}
          </div>
        ) : null}

        {toolbarActions.length > 0 ? (
          <div className="management-toolbar">
            {toolbarActions.map((action) => (
              <ToolbarAction key={action.label} action={action} disabled={isBusy || action.disabled} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="management-header-main">
        {!classesUnifiedFilterMode && isMobile ? (
          <div className="management-mobile-overview" data-testid="management-mobile-overview">
            <div className="management-mobile-overview-head">
              <div>
                <div className="management-mobile-overview-eyebrow">모바일 필터 요약</div>
                <strong className="management-mobile-overview-title">{count}개 결과</strong>
              </div>
              <span className="management-mobile-overview-badge">
                {activeFilterCount > 0 ? `필터 ${activeFilterCount}개` : '필터 대기 중'}
              </span>
            </div>

            {selectedQuickFilterTokens.length > 0 ? (
              <div className="management-mobile-overview-chips">
                {selectedQuickFilterTokens.map((token) => (
                  <span key={token} className="management-mobile-overview-chip">
                    {token}
                  </span>
                ))}
                {quickFilterOverflowCount > 0 ? (
                  <span className="management-mobile-overview-chip muted">+{quickFilterOverflowCount}</span>
                ) : null}
              </div>
            ) : (
              <div className="management-mobile-overview-copy">
                핵심 필터는 바로 보이고, 나머지는 고급 필터 시트에서 조정합니다.
              </div>
            )}
          </div>
        ) : null}

        <div className={`management-search-row ${classesUnifiedFilterMode ? 'is-toolbar-only' : ''}`}>
          {!classesUnifiedFilterMode ? (
            <div className="management-search-shell">
              <Search size={16} className="management-search-icon" />
              <input
                type="text"
                data-testid="management-search-input"
                className="styled-input management-search-input"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </div>
          ) : null}

          {tableControls ? (
            <div className="management-controls-row">
              <div ref={filterRef} className="management-control-anchor">
                <button
                  type="button"
                  data-testid="management-filter-button"
                  className="management-control-button"
                  onClick={() => {
                    if (isMobile) {
                      setIsMobileFilterSheetOpen(true);
                      return;
                    }
                    setIsColumnPanelOpen(false);
                    setIsFilterPanelOpen((current) => !current);
                  }}
                  disabled={isBusy}
                >
                  <Filter size={16} />
                  <span>{isMobile ? '고급 필터' : '필터/정렬'}</span>
                  {activeFilterCount > 0 ? (
                    <span className="management-control-badge">{activeFilterCount}</span>
                  ) : null}
                </button>

                {!isMobile && isFilterPanelOpen ? (
                  <div className="card-custom management-floating-panel management-floating-panel-wide">
                    <FloatingFilterPanel
                      tableControls={tableControls}
                      quickFilterOptions={quickFilterOptions}
                      floatingFilterColumns={floatingFilterColumns}
                      activeFilterCount={activeFilterCount}
                    />
                  </div>
                ) : null}
              </div>

              {!isMobile ? (
                <div ref={columnSelectorRef} className="management-control-anchor">
                  <button
                    type="button"
                    data-testid="management-columns-button"
                    className="management-icon-button"
                    onClick={() => {
                      setIsFilterPanelOpen(false);
                      setIsColumnPanelOpen((current) => !current);
                    }}
                    disabled={isBusy}
                    aria-label="컬럼 설정"
                  >
                    <Eye size={18} />
                  </button>

                  {isColumnPanelOpen ? (
                    <div className="card-custom management-floating-panel management-floating-panel-compact">
                      <ColumnPanel tableControls={tableControls} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {!classesUnifiedFilterMode && visibleQuickFilterColumns.length > 0 ? (
          <div className={`management-quick-filter-rail ${isMobile ? 'is-mobile' : ''}`}>
            {visibleQuickFilterColumns.map((column) => (
              <QuickFilterGroup
                key={column.key}
                column={column}
                options={quickFilterOptions[column.key] || tableControls.filterOptions[column.key] || []}
                selectedValues={tableControls.filters[column.key]}
                onChange={(value) => tableControls.setFilterValue(column.key, value)}
              />
            ))}
          </div>
        ) : null}

        {!classesUnifiedFilterMode && isMobile && mobileFilterSheetColumns.length > 0 ? (
          <div className="management-mobile-hint">
            나머지 필터와 정렬 옵션은 <strong>고급 필터</strong>에서 확인할 수 있습니다.
          </div>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div className="management-selection-banner">
          <div className="management-selection-copy">
            <strong className="management-selection-count">{selectedCount}개 선택</strong>
            <button
              type="button"
              className="management-inline-action"
              onClick={onToggleSelectAll}
            >
              {selectedCount === currentCount && currentCount > 0 ? '선택 해제' : '전체 선택'}
            </button>
            {onBulkUpdate ? (
              <button
                type="button"
                className="management-inline-action management-inline-action-accent"
                onClick={onBulkUpdate}
              >
                {bulkUpdateLabel}
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="management-danger-button"
            onClick={onDeleteSelected}
          >
            <Trash2 size={16} />
            <span>선택 삭제</span>
          </button>
        </div>
      ) : null}

      <BottomSheet
        open={Boolean(isMobile && isMobileFilterSheetOpen)}
        onClose={() => setIsMobileFilterSheetOpen(false)}
        title="고급 필터"
        subtitle="정렬, 그룹, 추가 필터를 한 번에 조정할 수 있습니다."
      >
        {tableControls ? (
          <div className="management-mobile-sheet-stack">
            {overflowQuickFilterColumns.length > 0 ? (
              <div className="management-mobile-sheet-section">
                <div className="management-panel-section-title">추가 빠른 필터</div>
                <div className="management-quick-filter-rail is-mobile">
                  {overflowQuickFilterColumns.map((column) => (
                    <QuickFilterGroup
                      key={column.key}
                      column={column}
                      options={quickFilterOptions[column.key] || tableControls.filterOptions[column.key] || []}
                      selectedValues={tableControls.filters[column.key]}
                      onChange={(value) => tableControls.setFilterValue(column.key, value)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <FloatingFilterPanel
              tableControls={tableControls}
              quickFilterOptions={quickFilterOptions}
              floatingFilterColumns={floatingFilterColumns}
              activeFilterCount={activeFilterCount}
            />

            <div className="management-mobile-sheet-section">
              <div className="management-panel-section-title">컬럼 설정</div>
              <ColumnPanel tableControls={tableControls} />
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
