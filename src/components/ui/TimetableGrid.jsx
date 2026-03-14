import { useEffect, useMemo, useState } from 'react';

function TimetableBlock({
  block,
  onClick,
  onMouseDown,
  suppressClick,
  isGhost = false,
  isSourceDragging = false,
}) {
  const classNames = [
    'timetable-block',
    block.clickable && !isGhost ? 'clickable' : '',
    block.editable ? 'editable' : '',
    isGhost ? 'ghost' : '',
    isSourceDragging ? 'drag-source' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      onClick={block.clickable && !isGhost && !suppressClick ? onClick : undefined}
      onMouseDown={isGhost ? undefined : onMouseDown}
      title={!block.editable && block.editableReason ? block.editableReason : undefined}
      style={{
        backgroundColor: block.backgroundColor || 'var(--bg-surface)',
        borderLeftColor: block.borderColor || 'var(--border-color)',
        color: block.textColor || 'var(--text-primary)',
        height: `${(block.endSlot - block.startSlot) * 48 - 2}px`,
        position: 'relative',
        cursor: isGhost ? 'grabbing' : block.editable ? 'grab' : block.clickable ? 'pointer' : 'default',
      }}
    >
      {block.variantDot && (
        <span className="block-variant-dot" title={block.variantDotTitle || '시간표 변형 정보가 있습니다.'} />
      )}
      {block.header && <div className="block-subject">{block.header}</div>}
      <div className="block-name">{block.title}</div>
      {(block.detailLines || []).map((line, index) => (
        <div
          key={`${block.key}-detail-${index}`}
          className="block-info"
          style={line.subtle ? { marginTop: 2, fontSize: 10, color: 'var(--text-muted)' } : undefined}
        >
          {line.label && (
            <span className="info-label" style={line.subtle ? { opacity: 0.7 } : undefined}>
              {line.label}
            </span>
          )}
          {line.value}
        </div>
      ))}
      {block.tooltip && <div className="tooltip">{block.tooltip}</div>}
    </div>
  );
}

function clampRange(startRow, endRow) {
  const min = Math.min(startRow, endRow);
  const max = Math.max(startRow, endRow);
  return { startRow: min, endRow: max + 1 };
}

function formatPreviewLabel(columns, timeSlots, previewRange) {
  if (!previewRange) {
    return '';
  }

  const start = timeSlots[previewRange.startRow]?.split('-')[0] || '09:00';
  const end = timeSlots[previewRange.endRow - 1]?.split('-')[1] || '09:30';
  const columnLabel = columns[previewRange.columnIndex] || '';
  return `${columnLabel} · ${start} ~ ${end}`;
}

export default function TimetableGrid({
  columns,
  timeSlots,
  blocks,
  timeColumnWidth = 70,
  minColumnWidth = 90,
  timeLabel = 'Time',
  editable = false,
  onCreateSelection,
  onMoveBlock,
}) {
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [selectionState, setSelectionState] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [suppressClick, setSuppressClick] = useState(false);

  const blockMap = useMemo(() => {
    const starts = new Map();
    const active = new Map();

    blocks.forEach((block) => {
      starts.set(`${block.columnIndex}-${block.startSlot}`, block);
      for (let row = block.startSlot; row < block.endSlot; row += 1) {
        active.set(`${block.columnIndex}-${row}`, block);
      }
    });

    return { starts, active };
  }, [blocks]);

  const previewRange = useMemo(() => {
    if (dragState?.targetColumnIndex !== undefined) {
      return {
        mode: 'move',
        columnIndex: dragState.targetColumnIndex,
        startRow: dragState.targetStartSlot,
        endRow: dragState.targetStartSlot + dragState.blockDuration,
      };
    }

    if (selectionState) {
      return {
        mode: 'selection',
        columnIndex: selectionState.columnIndex,
        startRow: selectionState.startRow,
        endRow: selectionState.endRow,
      };
    }

    return null;
  }, [dragState, selectionState]);

  const ghostBlock = useMemo(() => {
    if (!dragState) {
      return null;
    }

    const moved =
      dragState.block.columnIndex !== dragState.targetColumnIndex ||
      dragState.block.startSlot !== dragState.targetStartSlot;

    if (!moved) {
      return null;
    }

    return {
      ...dragState.block,
      key: `${dragState.block.key}-ghost`,
      columnIndex: dragState.targetColumnIndex,
      startSlot: dragState.targetStartSlot,
      endSlot: dragState.targetStartSlot + dragState.blockDuration,
      clickable: false,
      editable: false,
    };
  }, [dragState]);

  useEffect(() => {
    const clearTransientState = () => {
      setSelectionState(null);
      setDragState(null);
    };

    window.addEventListener('mouseup', clearTransientState);
    return () => window.removeEventListener('mouseup', clearTransientState);
  }, []);

  const startSelection = (columnIndex, rowIndex) => {
    if (!editable) {
      return;
    }

    setSelectionState({
      columnIndex,
      anchorRow: rowIndex,
      startRow: rowIndex,
      endRow: rowIndex + 1,
    });
  };

  const startDrag = (block) => {
    if (!editable || !block.editable) {
      return;
    }

    setDragState({
      block,
      targetColumnIndex: block.columnIndex,
      targetStartSlot: block.startSlot,
      blockDuration: block.endSlot - block.startSlot,
    });
  };

  const updatePointerState = (columnIndex, rowIndex, activeBlock) => {
    if (dragState) {
      setDragState((current) => {
        if (!current) return current;
        const maxStart = Math.max(0, timeSlots.length - current.blockDuration);
        return {
          ...current,
          targetColumnIndex: columnIndex,
          targetStartSlot: Math.min(Math.max(rowIndex, 0), maxStart),
        };
      });
    } else if (selectionState) {
      if (selectionState.columnIndex !== columnIndex) {
        return;
      }

      const range = clampRange(selectionState.anchorRow, rowIndex);
      setSelectionState((current) => current ? { ...current, ...range } : current);
    }

    if (selectionState || dragState) {
      return;
    }

    if (activeBlock) {
      setHoveredSlot({ col: columnIndex, startRow: activeBlock.startSlot, endRow: activeBlock.endSlot });
      return;
    }

    setHoveredSlot({ col: columnIndex, startRow: rowIndex, endRow: rowIndex + 1 });
  };

  const finishSelection = () => {
    if (!selectionState || !onCreateSelection) {
      setSelectionState(null);
      return;
    }

    onCreateSelection({
      columnIndex: selectionState.columnIndex,
      startSlot: selectionState.startRow,
      endSlot: selectionState.endRow,
    });
    setSelectionState(null);
  };

  const finishDrag = () => {
    if (!dragState || !onMoveBlock) {
      setDragState(null);
      return;
    }

    const moved =
      dragState.block.columnIndex !== dragState.targetColumnIndex ||
      dragState.block.startSlot !== dragState.targetStartSlot;

    if (moved) {
      onMoveBlock({
        block: dragState.block,
        columnIndex: dragState.targetColumnIndex,
        startSlot: dragState.targetStartSlot,
      });
      setSuppressClick(true);
      window.setTimeout(() => setSuppressClick(false), 0);
    }

    setDragState(null);
  };

  const previewLabel = formatPreviewLabel(columns, timeSlots, previewRange);
  const crosshairEnabled = !previewRange;

  return (
    <div
      className="timetable-grid-shell"
      style={{ overflowX: 'auto' }}
      onMouseLeave={() => setHoveredSlot(null)}
    >
      {previewLabel && (
        <div className={`timetable-preview-badge ${previewRange?.mode === 'move' ? 'is-move' : 'is-selection'}`}>
          {previewRange?.mode === 'move' ? '이동 예정' : '선택 범위'} · {previewLabel}
        </div>
      )}

      <div
        className="timetable-grid"
        style={{ gridTemplateColumns: `${timeColumnWidth}px repeat(${columns.length}, minmax(${minColumnWidth}px, 1fr))` }}
      >
        <div className="timetable-header-cell">{timeLabel}</div>
        {columns.map((column, columnIndex) => (
          <div
            key={column}
            className={`timetable-header-cell ${crosshairEnabled && hoveredSlot?.col === columnIndex ? 'hover-highlight' : ''}`}
          >
            {column}
          </div>
        ))}

        {timeSlots.map((time, rowIndex) => {
          const isTimeHovered =
            crosshairEnabled &&
            hoveredSlot &&
            rowIndex >= hoveredSlot.startRow &&
            rowIndex < hoveredSlot.endRow;

          return (
            <div style={{ display: 'contents' }} key={time}>
              <div
                className={`timetable-time-cell ${isTimeHovered ? 'hover-highlight' : ''}`}
                style={{ fontWeight: time.includes(':00-') ? 600 : 400 }}
              >
                {time}
              </div>

              {columns.map((column, columnIndex) => {
                const blockStart = blockMap.starts.get(`${columnIndex}-${rowIndex}`);
                const activeBlock = blockMap.active.get(`${columnIndex}-${rowIndex}`);
                const isHoveredColumn = crosshairEnabled && hoveredSlot?.col === columnIndex;
                const isHoveredRow = crosshairEnabled && hoveredSlot && rowIndex >= hoveredSlot.startRow && rowIndex < hoveredSlot.endRow;
                const isPreviewCell =
                  previewRange &&
                  previewRange.columnIndex === columnIndex &&
                  rowIndex >= previewRange.startRow &&
                  rowIndex < previewRange.endRow;
                const ghostStartsHere =
                  ghostBlock &&
                  ghostBlock.columnIndex === columnIndex &&
                  ghostBlock.startSlot === rowIndex;

                return (
                  <div
                    key={`${column}-${rowIndex}`}
                    className={[
                      'timetable-cell',
                      isHoveredColumn || isHoveredRow ? 'hover-highlight' : '',
                      isPreviewCell && previewRange?.mode === 'selection' ? 'selection-preview' : '',
                      isPreviewCell && previewRange?.mode === 'move' ? 'move-preview' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => updatePointerState(columnIndex, rowIndex, activeBlock)}
                    onMouseDown={() => {
                      if (!editable || activeBlock) {
                        return;
                      }
                      startSelection(columnIndex, rowIndex);
                    }}
                    onMouseUp={() => {
                      if (selectionState) {
                        finishSelection();
                      } else if (dragState) {
                        finishDrag();
                      }
                    }}
                  >
                    {blockStart && (
                      <TimetableBlock
                        block={blockStart}
                        isSourceDragging={Boolean(dragState && dragState.block.key === blockStart.key)}
                        suppressClick={suppressClick}
                        onClick={() => blockStart.onClick?.(blockStart)}
                        onMouseDown={(event) => {
                          if (!editable || !blockStart.editable) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          startDrag(blockStart);
                        }}
                      />
                    )}

                    {ghostStartsHere && (
                      <TimetableBlock
                        block={ghostBlock}
                        isGhost
                        suppressClick
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
