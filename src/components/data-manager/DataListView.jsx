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

function ClassMobileCard({
  item,
  itemSelected,
  selectable,
  onEdit,
  onDelete,
  isBusy,
  showActions,
  handleRowMouseDown,
}) {
  const title = getClassDisplayName(item) || '-';
  const status = getNormalizedClassStatus(item);
  const chips = [status, item.subject, item.grade].filter(Boolean);
  const studentCount = Array.isArray(item.studentIds) ? item.studentIds.length : 0;
  const capacity = Number(item.capacity || 0);
  const metaRows = [
    { key: 'schedule', icon: Clock3, label: '시간', value: getScheduleSummary(item.schedule) },
    { key: 'teacher', icon: UserRound, label: '선생님', value: item.teacher || '-' },
    { key: 'classroom', icon: MapPin, label: '강의실', value: item.classroom || item.room || '-' },
  ];

  return (
    <div
      className={`card-custom data-list-mobile-card data-list-mobile-card-class ${itemSelected ? 'is-selected' : ''}`}
      data-testid={`data-list-mobile-card-${item.id}`}
    >
      <div className="data-list-mobile-card-head">
        <div className="data-list-mobile-card-copy">
          <div className="data-list-mobile-card-head-row">
            {selectable ? (
              <button
                type="button"
                onClick={() => handleRowMouseDown(item.id, itemSelected, { preventDefault() {} })}
                className="data-list-selection-toggle"
              >
                {itemSelected ? <CheckSquare size={18} color="var(--accent-color)" /> : <Square size={18} color="var(--text-muted)" />}
              </button>
            ) : null}
            <button
              type="button"
              className="data-list-mobile-card-title"
              onClick={() => onEdit?.(item)}
              disabled={!onEdit}
            >
              {title}
            </button>
          </div>
          <div className="data-list-mobile-card-chips">
            {chips.map((chip) => (
              <span key={`${item.id}-${chip}`} className="data-list-mobile-card-chip">
                {chip}
              </span>
            ))}
          </div>
        </div>

        {showActions ? (
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
        ) : null}
      </div>

      <div className="data-list-mobile-class-meta">
        {metaRows.map(({ key, icon: Icon, label, value }) => (
          <div key={`${item.id}-${key}`} className="data-list-mobile-class-meta-item">
            <div className="data-list-mobile-class-meta-label">
              <Icon size={14} />
              <span>{label}</span>
            </div>
            <div className="data-list-mobile-class-meta-value">{value}</div>
          </div>
        ))}
      </div>

      <div className="data-list-mobile-class-footer">
        <span className="data-list-mobile-class-footer-badge">
          <Users size={13} />
          {capacity > 0 ? `수강 ${studentCount}/${capacity}` : `수강 ${studentCount}명`}
        </span>
        {onEdit ? (
          <button type="button" className="data-list-mobile-card-link" onClick={() => onEdit(item)}>
            상세 보기
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
      <div className="data-list-mobile-stack">
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
              return (
                <ClassMobileCard
                  key={row.key || item.id}
                  item={item}
                  itemSelected={itemSelected}
                  selectable={selectable}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  isBusy={isBusy}
                  showActions={showActions}
                  handleRowMouseDown={handleRowMouseDown}
                />
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

