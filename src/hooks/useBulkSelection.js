import { useCallback, useEffect, useState } from 'react';

export function useBulkSelection(resetKey, currentIds) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hoveredId, setHoveredId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPivotId, setDragPivotId] = useState(null);
  const [dragAction, setDragAction] = useState('select');

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    clearSelection();
    setHoveredId(null);
    setIsDragging(false);
    setDragPivotId(null);
    setDragAction('select');
  }, [clearSelection, resetKey]);

  useEffect(() => {
    setSelectedIds((previous) => {
      const nextSelection = new Set([...previous].filter((id) => currentIds.includes(id)));
      return nextSelection.size === previous.size ? previous : nextSelection;
    });
  }, [currentIds]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragPivotId(null);
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((previous) => {
      const nextSelection = new Set(previous);
      if (nextSelection.has(id)) {
        nextSelection.delete(id);
      } else {
        nextSelection.add(id);
      }
      return nextSelection;
    });
  }, []);

  const toggleSelectAll = useCallback((ids = currentIds) => {
    setSelectedIds((previous) => {
      if (ids.length > 0 && previous.size === ids.length) {
        return new Set();
      }

      return new Set(ids);
    });
  }, [currentIds]);

  const handleDragStart = useCallback((id, currentlySelected) => {
    setIsDragging(true);
    setDragPivotId(id);
    setDragAction(currentlySelected ? 'deselect' : 'select');

    setSelectedIds((previous) => {
      const nextSelection = new Set(previous);
      if (currentlySelected) {
        nextSelection.delete(id);
      } else {
        nextSelection.add(id);
      }
      return nextSelection;
    });
  }, []);

  const handleDragEnter = useCallback((targetId, visibleIds = currentIds) => {
    if (!isDragging || !dragPivotId) {
      return;
    }

    const pivotIndex = visibleIds.indexOf(dragPivotId);
    const targetIndex = visibleIds.indexOf(targetId);

    if (pivotIndex === -1 || targetIndex === -1) {
      return;
    }

    const start = Math.min(pivotIndex, targetIndex);
    const end = Math.max(pivotIndex, targetIndex);
    const rangeIds = visibleIds.slice(start, end + 1);

    setSelectedIds((previous) => {
      const nextSelection = new Set(previous);
      rangeIds.forEach((id) => {
        if (dragAction === 'select') {
          nextSelection.add(id);
        } else {
          nextSelection.delete(id);
        }
      });
      return nextSelection;
    });
  }, [currentIds, dragAction, dragPivotId, isDragging]);

  return {
    selectedIds,
    setSelectedIds,
    hoveredId,
    setHoveredId,
    isDragging,
    toggleSelect,
    toggleSelectAll,
    handleDragStart,
    handleDragEnter,
    clearSelection
  };
}
