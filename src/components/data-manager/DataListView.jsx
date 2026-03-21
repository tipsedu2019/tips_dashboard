import { memo, useCallback, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ClipboardList,
  Clock3,
  MapPin,
  Pencil,
  Square,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { PublicLandingCard } from '../PublicClassLandingView';
import useViewport from '../../hooks/useViewport';
import {
  getClassDisplayName,
  getNormalizedClassStatus,
  getScheduleSummary,
} from './utils';

function EmptyState({ title, description }) {
  return (
    <tr>
      <td colSpan={99} className="data-list-empty-cell">
        <div className="data-list-empty-state">
          <ClipboardList size={48} strokeWidth={1.5} />
          <div className="data-list-empty-title">{title}</div>
          <div className="data-list-empty-description">{description}</div>
        </div>
      </td>
    </tr>
  );
}

function GroupRow({ row, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className={`data-list-group-row depth-${Math.min(row.depth || 0, 2)}`}>
        <span className="data-list-group-label" style={{ marginLeft: row.depth * 18 }}>
          {row.column.label}: {row.value}
        </span>
        <span className="data-list-group-count">{row.count}개</span>
      </td>
    </tr>
  );
}

function PaginationBar({
  page,
  pageSize,
  totalPages,
  totalCount,
  pageStart,
  pageEnd,
  onPageChange,
  onPageSizeChange,
}) {
  if (!totalCount) {
    return null;
  }

  return (
    <div className="data-list-pagination">
      <div className="data-list-pagination-copy">
        <strong>{pageStart}-{pageEnd}</strong>
        <span> / {totalCount}개 항목</span>
      </div>

      <div className="data-list-pagination-controls">
        <label className="data-list-pagination-size">
          <span>페이지당</span>
          <select value={pageSize} onChange={(event) => onPageSizeChange?.(Number(event.target.value))}>
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => onPageChange?.(page - 1)}
          disabled={page <= 1}
          style={{ minWidth: 68 }}
        >
          이전
        </button>
        <div className="data-list-pagination-status">
          {page} / {totalPages}
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onPageChange?.(page + 1)}
          disabled={page >= totalPages}
          style={{ minWidth: 68 }}
        >
          다음
        </button>
      </div>
    </div>
  );
}

/* ClassMobileCard removed — PublicLandingCard is used instead */

const DataRow = memo(function DataRow({
  item,
  columns,
  currentIds,
  selectable,
  isSelected,
  isHovered,
  depth = 0,
  onRowMouseEnter,
  onRowMouseLeave,
  onRowMouseDown,
  onRowDoubleClick,
  onEdit,
  onDelete,
  editingCell,
  editValue,
  setEditValue,
  submitInlineEdit,
  handleKeyDown,
  isBusy,
  showActions,
}) {
  return (
    <tr
      onMouseEnter={() => onRowMouseEnter?.(item.id, currentIds)}
      onMouseLeave={onRowMouseLeave}
      className={`data-list-row ${isSelected ? 'is-selected' : ''}`}
    >
      {selectable && currentIds && (
        <td className="data-list-cell data-list-cell-select" onMouseDown={(event) => onRowMouseDown?.(item.id, isSelected, event)}>
          {isSelected ? <CheckSquare size={18} color="var(--accent-color)" /> : <Square size={18} color="var(--text-muted)" />}
        </td>
      )}

      {columns.map((column, index) => {
        const isEditing = editingCell?.key === column.key;

        return (
          <td
            key={column.key}
            className="data-list-cell"
            style={index === 0 && depth > 0 ? { paddingLeft: 16 + depth * 18 } : undefined}
            onDoubleClick={() => {
              if (column.canInlineEdit && !isBusy) {
                onRowDoubleClick(item.id, column.key, column.getEditValue ? column.getEditValue(item) : item[column.key] || '');
              }
            }}
          >
            {isEditing ? (
              column.multiline ? (
                <textarea
                  autoFocus
                  className="styled-input data-list-inline-editor data-list-inline-editor-textarea"
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onBlur={submitInlineEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      onRowDoubleClick(null, null, '');
                    } else if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitInlineEdit();
                    }
                  }}
                />
              ) : column.editKind === 'select' ? (
                <select
                  autoFocus
                  className="styled-input data-list-inline-editor"
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onBlur={submitInlineEdit}
                  onKeyDown={handleKeyDown}
                >
                  {(column.editOptions || []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus
                  type={column.editKind === 'date' ? 'date' : (column.inputType || 'text')}
                  className="styled-input data-list-inline-editor"
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onBlur={submitInlineEdit}
                  onKeyDown={handleKeyDown}
                />
              )
            ) : (
              column.render ? column.render(item) : item[column.key] || '-'
            )}
          </td>
        );
      })}

      {showActions && (
        <td className="data-list-cell data-list-cell-actions">
          <div className={`data-list-row-actions ${isHovered || isSelected ? 'is-visible' : ''}`}>
            <button
              type="button"
              onClick={() => onEdit?.(item)}
              className="btn-icon data-list-card-action"
              disabled={isBusy}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(item.id)}
              className="btn-icon data-list-card-action is-danger"
              disabled={isBusy}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
});

export default function DataListView({
  columns,
  listData,
  rowModels,
  emptyTitle,
  emptyDescription,
  onEdit,
  onDelete,
  selectedIds,
  currentIds,
  toggleSelectAll,
  hoveredId,
  setHoveredId,
  onDragStart,
  onDragEnter,
  activeTab,
  onInlineEdit,
  isBusy = false,
  selectable = true,
  showActions = true,
  cardless = false,
  sortKey,
  sortDirection,
  onSortChange,
  page = 1,
  pageSize = 50,
  totalPages = 1,
  totalCount = 0,
  pageStart = 0,
  pageEnd = 0,
  onPageChange,
  onPageSizeChange,
  testId = '',
  mobileCardPrimaryActionLabel = '',
  onMobileCardPrimaryAction = null,
  mobileCardPrimaryActionTestIdPrefix = '',
}) {
  const { isMobile } = useViewport();
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');

  const displayRows = useMemo(() => (
    rowModels && rowModels.length > 0
      ? rowModels
      : listData.map((item) => ({ type: 'item', key: `item:${item.id}`, item, depth: 0 }))
  ), [listData, rowModels]);

  const submitInlineEdit = useCallback(async () => {
    if (!editingCell) {
      return;
    }

    await onInlineEdit(editingCell.id, editingCell.key, editValue, activeTab);
    setEditingCell(null);
  }, [activeTab, editValue, editingCell, onInlineEdit]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      submitInlineEdit();
    } else if (event.key === 'Escape') {
      setEditingCell(null);
    }
  }, [submitInlineEdit]);

  const handleRowDoubleClick = useCallback((itemId, key, value) => {
    if (key === null) {
      setEditingCell(null);
      return;
    }

    setEditingCell({ id: itemId, key });
    setEditValue(value);
  }, []);

  const handleRowMouseDown = useCallback((itemId, isSelected, event) => {
    event.preventDefault();
    onDragStart?.(itemId, isSelected);
  }, [onDragStart]);

  const handleRowMouseEnter = useCallback((itemId, ids) => {
    setHoveredId?.(itemId);
    onDragEnter?.(itemId, ids);
  }, [onDragEnter, setHoveredId]);

  const colSpan = (selectable ? 1 : 0) + columns.length + (showActions ? 1 : 0);

  if (isMobile) {
    const visibleColumns = columns.slice(0, 6);

    return (
      <div className="data-list-mobile-stack" data-testid={testId || undefined}>
        {listData.length === 0 ? (
          <div className="card-custom data-list-mobile-empty-card">
            <div className="data-list-empty-state">
              <ClipboardList size={44} strokeWidth={1.5} />
              <div className="data-list-empty-title">{emptyTitle}</div>
              <div className="data-list-empty-description">{emptyDescription}</div>
            </div>
          </div>
        ) : (
          displayRows.map((row) => {
            if (row.type === 'group') {
              return (
                <div
                  key={row.key}
                  className={`card-custom data-list-group-card depth-${Math.min(row.depth || 0, 2)}`}
                >
                  <div className="data-list-group-card-title">
                    {row.column.label}: {row.value}
                  </div>
                  <div className="data-list-group-card-count">
                    {row.count}개
                  </div>
                </div>
              );
            }

            const item = row.item;
            const itemSelected = selectedIds?.has?.(item.id);

            if (activeTab === 'classes') {
              const primaryAction = onMobileCardPrimaryAction || onEdit;
              const shouldShowPrimaryAction = Boolean(mobileCardPrimaryActionLabel && primaryAction);

              return (
                <div
                  key={row.key || item.id}
                  className="data-list-landing-card-wrap"
                  data-testid={`data-list-mobile-card-${item.id}`}
                >
                  <PublicLandingCard
                    classItem={item}
                    onOpenDetails={onEdit}
                    hideActions
                    semanticButton={false}
                  />
                  {(shouldShowPrimaryAction || showActions) && (
                    <div className="data-list-landing-card-actions">
                      {shouldShowPrimaryAction && (
                        <button
                          type="button"
                          onClick={() => primaryAction?.(item)}
                          className={`${showActions ? 'btn-secondary' : 'btn-primary'} data-list-landing-action-btn`}
                          data-testid={mobileCardPrimaryActionTestIdPrefix ? `${mobileCardPrimaryActionTestIdPrefix}-${item.id}` : undefined}
                          disabled={isBusy}
                        >
                          <Clock3 size={14} />
                          {mobileCardPrimaryActionLabel}
                        </button>
                      )}
                      {showActions && (
                        <>
                      <button
                        type="button"
                        onClick={() => onEdit?.(item)}
                        className="btn-secondary data-list-landing-action-btn"
                        disabled={isBusy}
                      >
                        <Pencil size={14} />
                        편집
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete?.(item.id)}
                        className="btn-secondary data-list-landing-action-btn is-danger"
                        disabled={isBusy}
                      >
                        <Trash2 size={14} />
                        삭제
                      </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={row.key || item.id}
                className="card-custom data-list-mobile-card"
                data-testid={`data-list-mobile-card-${item.id}`}
                data-selected={itemSelected ? 'true' : 'false'}
              >
                <div className="data-list-mobile-card-head is-generic">
                  <div className="data-list-mobile-card-heading">
                    {selectable && (
                      <button
                        type="button"
                        onClick={() => handleRowMouseDown(item.id, itemSelected, { preventDefault() {} })}
                        className="data-list-selection-toggle"
                      >
                        {itemSelected ? <CheckSquare size={18} color="var(--accent-color)" /> : <Square size={18} color="var(--text-muted)" />}
                      </button>
                    )}
                    <div className="data-list-mobile-card-heading-value">
                      {visibleColumns[0]?.render ? visibleColumns[0].render(item) : item[visibleColumns[0]?.key] || '-'}
                    </div>
                  </div>
                  {showActions && (
                    <div className="data-list-mobile-card-actions">
                      <button
                        type="button"
                        onClick={() => onEdit?.(item)}
                        className="btn-icon data-list-card-action"
                        disabled={isBusy}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete?.(item.id)}
                        className="btn-icon data-list-card-action is-danger"
                        disabled={isBusy}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="data-list-mobile-field-grid">
                  {visibleColumns.slice(1).map((column) => (
                    <div key={`${item.id}-${column.key}`} className="data-list-mobile-field">
                      <div className="data-list-mobile-field-label">{column.label}</div>
                      <div className="data-list-mobile-field-value">
                        {column.render ? column.render(item) : item[column.key] || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}

        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          totalCount={totalCount}
          pageStart={pageStart}
          pageEnd={pageEnd}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
    );
  }

  return (
    <div
      className={cardless ? 'data-list-shell data-list-shell-cardless' : 'card-custom data-list-shell'}
      data-testid={testId || undefined}
    >
      <div className={`data-list-table-scroll ${cardless ? 'is-cardless' : ''}`}>
        <table className="data-list-table">
          <thead>
            <tr className="data-list-head-row">
              {selectable && (
                <th className="data-list-head-cell is-select">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll?.(currentIds)}
                    className="data-list-selection-toggle"
                  >
                    {selectedIds?.size === currentIds?.length && currentIds?.length > 0
                      ? <CheckSquare size={18} color="var(--accent-color)" />
                      : <Square size={18} color="var(--text-muted)" />}
                  </button>
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="data-list-head-cell"
                  onClick={() => onSortChange?.(column.key)}
                >
                  <span className="data-list-head-label">
                    {column.label}
                    {sortKey === column.key && (
                      sortDirection === 'asc'
                        ? <ArrowUp size={12} />
                        : <ArrowDown size={12} />
                    )}
                  </span>
                </th>
              ))}
              {showActions && (
                <th className="data-list-head-cell is-actions">작업</th>
              )}
            </tr>
          </thead>
          <tbody>
            {listData.length === 0 ? (
              <EmptyState title={emptyTitle} description={emptyDescription} />
            ) : (
              displayRows.map((row) => {
                if (row.type === 'group') {
                  return <GroupRow key={row.key} row={row} colSpan={colSpan} />;
                }

                return (
                  <DataRow
                    key={row.key || row.item.id}
                    item={row.item}
                    columns={columns}
                    currentIds={currentIds}
                    selectable={selectable}
                    isSelected={selectedIds?.has?.(row.item.id)}
                    isHovered={hoveredId === row.item.id}
                    depth={row.depth || 0}
                    onRowMouseEnter={handleRowMouseEnter}
                    onRowMouseLeave={() => setHoveredId?.(null)}
                    onRowMouseDown={handleRowMouseDown}
                    onRowDoubleClick={handleRowDoubleClick}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    editingCell={editingCell?.id === row.item.id ? editingCell : null}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    submitInlineEdit={submitInlineEdit}
                    handleKeyDown={handleKeyDown}
                    isBusy={isBusy}
                    showActions={showActions}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        totalCount={totalCount}
        pageStart={pageStart}
        pageEnd={pageEnd}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
