import { memo, useCallback, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ClipboardList,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react';

function EmptyState({ title, description }) {
  return (
    <tr>
      <td colSpan={99} style={{ padding: '72px 24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.75 }}>
          <ClipboardList size={48} strokeWidth={1.5} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{description}</div>
        </div>
      </td>
    </tr>
  );
}

function GroupRow({ row, colSpan }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          padding: '10px 16px',
          background: row.depth === 0 ? 'rgba(33, 110, 78, 0.08)' : 'rgba(33, 110, 78, 0.04)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-primary)',
        }}
      >
        <span style={{ marginLeft: row.depth * 18 }}>
          {row.column.label}: {row.value}
        </span>
        <span style={{ marginLeft: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
          {row.count}개
        </span>
      </td>
    </tr>
  );
}

const DataRow = memo(function DataRow({
  item,
  columns,
  currentIds,
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
      style={{
        borderBottom: '1px solid var(--border-color)',
        background: isSelected ? 'rgba(57, 158, 116, 0.04)' : 'transparent',
        transition: 'background 0.2s',
        userSelect: 'none',
      }}
    >
      {currentIds && (
        <td style={{ padding: '12px 16px', cursor: 'pointer' }} onMouseDown={(event) => onRowMouseDown?.(item.id, isSelected, event)}>
          {isSelected ? <CheckSquare size={18} color="var(--accent-color)" /> : <Square size={18} color="var(--text-muted)" />}
        </td>
      )}

      {columns.map((column, index) => {
        const isEditing = editingCell?.key === column.key;

        return (
          <td
            key={column.key}
            style={{
              padding: '12px 16px',
              fontSize: 14,
              verticalAlign: 'top',
              ...(index === 0 && depth > 0 ? { paddingLeft: 16 + depth * 18 } : null),
            }}
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
                  className="styled-input"
                  style={{ padding: 8, fontSize: 13, minHeight: 68, width: '100%', margin: 0, resize: 'vertical' }}
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
                  className="styled-input"
                  style={{ padding: '4px 8px', fontSize: 13, height: 34, margin: 0, width: '100%' }}
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
                  className="styled-input"
                  style={{ padding: '4px 8px', fontSize: 13, height: 30, margin: 0, width: '100%' }}
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
        <td style={{ padding: '12px 16px', textAlign: 'right', minWidth: 90 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 6,
              opacity: isHovered || isSelected ? 1 : 0,
              transition: 'opacity 0.15s ease',
            }}
          >
            <button
              type="button"
              onClick={() => onEdit?.(item)}
              className="btn-icon"
              style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              disabled={isBusy}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(item.id)}
              className="btn-icon"
              style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
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
  sortKey,
  sortDirection,
  onSortChange,
}) {
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

  return (
    <div className="card-custom" style={{ overflow: 'hidden', padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface-hover)', borderBottom: '1px solid var(--border-color)' }}>
              {selectable && (
                <th style={{ padding: '12px 16px', textAlign: 'left', width: 44 }}>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll?.(currentIds)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
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
                  style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => onSortChange?.(column.key)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
                <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>작업</th>
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
    </div>
  );
}
