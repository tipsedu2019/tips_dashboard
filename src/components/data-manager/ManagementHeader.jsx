import { Trash2 } from 'lucide-react';

export default function ManagementHeader({
  selectedCount = 0,
  currentCount = 0,
  onToggleSelectAll,
  onDeleteSelected,
  onBulkUpdate,
  bulkUpdateLabel = '일괄 수정',
}) {
  if (selectedCount <= 0) {
    return null;
  }

  return (
    <div className="management-selection-banner">
      <div className="management-selection-copy">
        <strong className="management-selection-count">{selectedCount}개 선택</strong>
        <button type="button" className="management-inline-action" onClick={onToggleSelectAll}>
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

      <button type="button" className="management-danger-button" onClick={onDeleteSelected}>
        <Trash2 size={16} />
        <span>선택 삭제</span>
      </button>
    </div>
  );
}
