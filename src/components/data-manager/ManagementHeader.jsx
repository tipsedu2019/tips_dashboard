import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Filter, Search, Trash2 } from 'lucide-react';
import { CLASS_COLUMN_LABELS } from './utils';
import useViewport from '../../hooks/useViewport';

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
        className="styled-input"
        multiple
        value={value || []}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
        style={{ minHeight: 88 }}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
  const content = (
    <>
      {action.icon}
      {action.label}
    </>
  );

  if (action.kind === 'file') {
    return (
      <label
        className={action.variant === 'primary' ? 'btn-primary' : 'btn-secondary'}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '8px 16px',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 38,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {content}
        <input
          type="file"
          accept={action.accept || '.xlsx,.xls,.csv'}
          style={{ display: 'none' }}
          disabled={disabled}
          onChange={action.onChange}
        />
      </label>
    );
  }

  return (
    <button
      type="button"
      className={action.variant === 'primary' ? 'btn-primary' : 'btn-secondary'}
      onClick={action.onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 38,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {content}
    </button>
  );
}

export default function ManagementHeader({
  title,
  description,
  count,
  searchValue,
  onSearchChange,
  toolbarActions = [],
  selectedCount,
  currentCount,
  onToggleSelectAll,
  onDeleteSelected,
  onBulkUpdate,
  bulkUpdateLabel,
  isBusy = false,
  tableControls,
  searchPlaceholder = '이름, 수업명, 교재명으로 검색',
}) {
  const { isMobile } = useViewport();
  const columnSelectorRef = useRef(null);
  const filterRef = useRef(null);
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

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

  return (
    <div className="card-custom p-6" style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h3>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-muted)' }}>
            현재 {count}개 항목
          </div>
          {description ? (
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 720 }}>
              {description}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {toolbarActions.map((action) => (
            <ToolbarAction key={action.label} action={action} disabled={isBusy || action.disabled} />
          ))}

          {tableControls && (
            <div ref={filterRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsFilterPanelOpen((current) => !current)}
                style={{ padding: '8px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                disabled={isBusy}
              >
                <Filter size={16} />
                필터/정렬
                {activeFilterCount > 0 && (
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: 'var(--accent-light)',
                      color: 'var(--accent-color)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {isFilterPanelOpen && (
                <div
                  className="card-custom"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    zIndex: 1200,
                    width: isMobile ? 'min(100vw - 32px, 360px)' : 360,
                    maxHeight: 520,
                    overflowY: 'auto',
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                      정렬
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={tableControls.clearAllFilters}
                    >
                      필터 초기화
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
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
                      className="btn-secondary"
                      style={{ width: 44, justifyContent: 'center', padding: 0 }}
                      onClick={() =>
                        tableControls.setSort(
                          tableControls.sortState.key,
                          tableControls.sortState.direction === 'asc' ? 'desc' : 'asc'
                        )
                      }
                    >
                      {tableControls.sortState.direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                      그룹
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={tableControls.clearGrouping}
                    >
                      그룹 초기화
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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

                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', paddingTop: 4 }}>
                    컬럼 필터
                  </div>

                  {tableControls.columns.filter((column) => column.filterKind).map((column) => (
                    <div key={column.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {column.label}
                      </label>
                      {renderFilterControl({
                        column,
                        value: tableControls.filters[column.key],
                        onChange: (value) => tableControls.setFilterValue(column.key, value),
                        options: tableControls.filterOptions[column.key] || [],
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tableControls && (
            <div ref={columnSelectorRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsColumnPanelOpen((current) => !current)}
                style={{ padding: 8, background: 'var(--bg-surface-hover)' }}
                disabled={isBusy}
              >
                <Eye size={18} />
              </button>

              {isColumnPanelOpen && (
                <div
                  className="card-custom"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    zIndex: 1200,
                    width: isMobile ? 'min(100vw - 32px, 280px)' : 220,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                      표시할 컬럼 선택
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={tableControls.resetColumnOrder}
                    >
                      순서 초기화
                    </button>
                  </div>
                  {tableControls.columns.map((column) => (
                    <div
                      key={column.key}
                      style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10, fontSize: 13 }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={tableControls.visibleMap[column.key] !== false}
                          onChange={() => tableControls.toggleColumnVisibility(column.key)}
                        />
                        {CLASS_COLUMN_LABELS[column.key] || column.label || column.key}
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }}
                          onClick={() => tableControls.moveColumn(column.key, 'up')}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }}
                          onClick={() => tableControls.moveColumn(column.key, 'down')}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 2, minWidth: 220 }}>
          <Search
            size={16}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.55 }}
          />
          <input
            type="text"
            className="styled-input"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            style={{ paddingLeft: 40, width: '100%' }}
          />
        </div>
      </div>

      {selectedCount > 0 && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            background: 'rgba(57, 158, 116, 0.05)',
            border: '1px solid rgba(57, 158, 116, 0.2)',
            borderRadius: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--accent-color)' }}>{selectedCount}개 선택됨</strong>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={onToggleSelectAll}
            >
              {selectedCount === currentCount && currentCount > 0 ? '선택 해제' : '전체 선택'}
            </button>
            {onBulkUpdate && (
              <button
                type="button"
                className="btn-secondary"
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: 'none',
                  background: 'var(--accent-light)',
                  color: 'var(--accent-color)',
                }}
                onClick={onBulkUpdate}
              >
                {bulkUpdateLabel}
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn-secondary"
            style={{ background: '#fee2e2', color: '#ef4444', border: 'none', padding: '8px 16px', fontWeight: 700 }}
            onClick={onDeleteSelected}
          >
            <Trash2 size={16} style={{ marginRight: 8 }} />
            선택 삭제
          </button>
        </div>
      )}
    </div>
  );
}
