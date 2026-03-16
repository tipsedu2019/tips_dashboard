import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

function TimetableBlock({
  block,
  onClick,
  onMouseDown,
  onResizeStart,
  onDiscard,
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
    block.warning ? 'warning' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      onClick={block.clickable && !isGhost && !suppressClick ? onClick : undefined}
      onMouseDown={isGhost ? undefined : onMouseDown}
      title={!block.editable && !isGhost && block.editableReason ? block.editableReason : undefined}
      style={{
        backgroundColor: block.backgroundColor || 'var(--bg-surface)',
        borderLeftColor: block.borderColor || 'var(--border-color)',
        color: block.textColor || 'var(--text-primary)',
        height: `${(block.endSlot - block.startSlot) * 48 - 2}px`,
        position: 'relative',
        cursor: isGhost ? 'grabbing' : block.editable ? 'grab' : block.clickable ? 'pointer' : 'default',
      }}
    >
      {block.variantDot ? (
        <span className="block-variant-dot" title={block.variantDotTitle || '여러 배치 변형이 있습니다.'} />
      ) : null}

      {block.discardable && !isGhost ? (
        <button
          type="button"
          className="timetable-block-discard"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDiscard?.();
          }}
          title="배치 취소"
        >
          <Trash2 size={12} />
        </button>
      ) : null}

      {block.showResizeHandles && !isGhost ? (
        <>
          <button
            type="button"
            className="timetable-resize-handle top"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onResizeStart?.('start');
            }}
            title="시작 시간 조정"
          />
          <button
            type="button"
            className="timetable-resize-handle bottom"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onResizeStart?.('end');
            }}
            title="종료 시간 조정"
          />
        </>
      ) : null}

      {block.header ? <div className="block-subject">{block.header}</div> : null}
      <div className="block-name">{block.title}</div>
      {(block.detailLines || []).map((line, index) => (
        <div
          key={`${block.key}-detail-${index}`}
          className="block-info"
          style={line.subtle ? { marginTop: 2, fontSize: 10, color: 'var(--text-muted)' } : undefined}
        >
          {line.label ? (
            <span className="info-label" style={line.subtle ? { opacity: 0.7 } : undefined}>
              {line.label}
            </span>
          ) : null}
          {line.value}
        </div>
      ))}
      {block.tooltip ? <div className="tooltip">{block.tooltip}</div> : null}
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

function clampResizeRange(edge, rowIndex, block, totalSlots) {
  if (edge === 'start') {
    const nextStart = Math.min(Math.max(rowIndex, 0), block.endSlot - 1);
    return {
      startRow: nextStart,
      endRow: block.endSlot,
    };
  }

  const nextEnd = Math.max(Math.min(rowIndex + 1, totalSlots), block.startSlot + 1);
  return {
    startRow: block.startSlot,
    endRow: nextEnd,
  };
}

function getExternalDropRange(rowIndex, totalSlots, durationSlots) {
  const safeDuration = Math.max(1, Number(durationSlots) || 4);
  const maxStart = Math.max(0, totalSlots - safeDuration);
  const startRow = Math.min(Math.max(rowIndex, 0), maxStart);
  const endRow = Math.min(startRow + safeDuration, totalSlots);
  return {
    startRow,
    endRow,
  };
}

export default function TimetableGrid({
  columns,
  timeSlots,
  blocks,
  timeColumnWidth = 70,
  minColumnWidth = 90,
  timeLabel = '시간',
  editable = false,
  editableMode = 'view',
  onCreateSelection,
  onMoveBlock,
  onResizeBlock,
  onDiscardBlock,
  onDropDraftItem,
  showResizeHandles = false,
  invalidRanges = [],
  warningRanges = [],
  externalDraggingDraft = null,
  externalPreviewRange = null,
  onExternalPreviewChange,
}) {
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [selectionState, setSelectionState] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const [suppressClick, setSuppressClick] = useState(false);

  const externalDragActive = Boolean(externalDraggingDraft?.classId);

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
    if (resizeState?.columnIndex !== undefined) {
      return {
        mode: 'resize',
        columnIndex: resizeState.columnIndex,
        startRow: resizeState.startRow,
        endRow: resizeState.endRow,
      };
    }

    if (dragState?.targetColumnIndex !== undefined) {
      return {
        mode: 'move',
        columnIndex: dragState.targetColumnIndex,
        startRow: dragState.targetStartSlot,
        endRow: dragState.targetStartSlot + dragState.blockDuration,
      };
    }

    if (externalPreviewRange?.columnIndex !== undefined) {
      return {
        mode: 'external',
        columnIndex: externalPreviewRange.columnIndex,
        startRow: externalPreviewRange.startRow,
        endRow: externalPreviewRange.endRow,
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
  }, [dragState, externalPreviewRange, resizeState, selectionState]);

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

  const externalGhostBlock = useMemo(() => {
    if (!externalDraggingDraft?.block || !externalPreviewRange) {
      return null;
    }

    return {
      ...externalDraggingDraft.block,
      key: `${externalDraggingDraft.block.key}-ghost`,
      columnIndex: externalPreviewRange.columnIndex,
      startSlot: externalPreviewRange.startRow,
      endSlot: externalPreviewRange.endRow,
      clickable: false,
      editable: false,
    };
  }, [externalDraggingDraft, externalPreviewRange]);

  const handlePointerUp = () => {
    if (selectionState) {
      try {
        if (onCreateSelection) {
          onCreateSelection({
            columnIndex: selectionState.columnIndex,
            startSlot: selectionState.startRow,
            endSlot: selectionState.endRow,
          });
        }
      } catch (error) {
        console.error('timetable create selection failed', error);
      }
      setSelectionState(null);
      return;
    }

    if (resizeState) {
      try {
        if (onResizeBlock) {
          onResizeBlock({
            block: resizeState.block,
            startSlot: resizeState.startRow,
            endSlot: resizeState.endRow,
          });
          setSuppressClick(true);
          window.setTimeout(() => setSuppressClick(false), 0);
        }
      } catch (error) {
        console.error('timetable resize failed', error);
      }
      setResizeState(null);
      return;
    }

    if (dragState) {
      const moved =
        dragState.block.columnIndex !== dragState.targetColumnIndex ||
        dragState.block.startSlot !== dragState.targetStartSlot;

      try {
        if (moved && onMoveBlock) {
          onMoveBlock({
            block: dragState.block,
            columnIndex: dragState.targetColumnIndex,
            startSlot: dragState.targetStartSlot,
          });
          setSuppressClick(true);
          window.setTimeout(() => setSuppressClick(false), 0);
        }
      } catch (error) {
        console.error('timetable move failed', error);
      }

      setDragState(null);
    }
  };

  useEffect(() => {
    const clearTransientState = () => {
      handlePointerUp();
    };

    window.addEventListener('mouseup', clearTransientState);
    return () => window.removeEventListener('mouseup', clearTransientState);
  });

  useEffect(() => {
    if (!externalDragActive) {
      onExternalPreviewChange?.(null);
    }
  }, [externalDragActive, onExternalPreviewChange]);

  const startSelection = (columnIndex, rowIndex) => {
    if (!editable || externalDragActive) {
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
    if (!editable || !block.editable || externalDragActive) {
      return;
    }

    setDragState({
      block,
      targetColumnIndex: block.columnIndex,
      targetStartSlot: block.startSlot,
      blockDuration: block.endSlot - block.startSlot,
    });
  };

  const startResize = (block, edge) => {
    if (!editable || !block.editable || !onResizeBlock || externalDragActive) {
      return;
    }

    setResizeState({
      block,
      edge,
      columnIndex: block.columnIndex,
      startRow: block.startSlot,
      endRow: block.endSlot,
    });
  };

  const updatePointerState = (columnIndex, rowIndex, activeBlock) => {
    if (externalDragActive) {
      return;
    }

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
      return;
    }

    if (resizeState) {
      if (resizeState.columnIndex !== columnIndex) {
        return;
      }
      const nextRange = clampResizeRange(resizeState.edge, rowIndex, resizeState.block, timeSlots.length);
      setResizeState((current) => current ? { ...current, ...nextRange } : current);
      return;
    }

    if (selectionState) {
      if (selectionState.columnIndex !== columnIndex) {
        return;
      }

      const range = clampRange(selectionState.anchorRow, rowIndex);
      setSelectionState((current) => current ? { ...current, ...range } : current);
      return;
    }

    if (activeBlock) {
      setHoveredSlot({ col: columnIndex, startRow: activeBlock.startSlot, endRow: activeBlock.endSlot });
      return;
    }

    setHoveredSlot({ col: columnIndex, startRow: rowIndex, endRow: rowIndex + 1 });
  };

  const updateExternalPreview = (columnIndex, rowIndex, activeBlock) => {
    if (!externalDragActive) {
      return;
    }

    if (!editable || editableMode === 'view' || activeBlock) {
      onExternalPreviewChange?.(null);
      return;
    }

    onExternalPreviewChange?.({
      columnIndex,
      ...getExternalDropRange(rowIndex, timeSlots.length, externalDraggingDraft?.durationSlots),
    });
  };

  const previewLabel = formatPreviewLabel(columns, timeSlots, previewRange);
  const crosshairEnabled = !previewRange;

  return (
    <div
      className="timetable-grid-shell"
      style={{ overflowX: 'auto' }}
      onMouseLeave={() => {
        setHoveredSlot(null);
        if (externalDragActive) {
          onExternalPreviewChange?.(null);
        }
      }}
      onMouseUp={handlePointerUp}
    >
      {previewLabel ? (
        <div
          className={[
            'timetable-preview-badge',
            previewRange?.mode === 'move' ? 'is-move' : '',
            previewRange?.mode === 'external' ? 'is-external' : '',
          ].filter(Boolean).join(' ')}
        >
          {previewRange?.mode === 'selection'
            ? '선택 범위'
            : previewRange?.mode === 'resize'
              ? '크기 조절'
              : previewRange?.mode === 'external'
                ? '새 배치'
                : '이동 예정'} · {previewLabel}
        </div>
      ) : null}

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
                const externalGhostStartsHere =
                  externalGhostBlock &&
                  externalGhostBlock.columnIndex === columnIndex &&
                  externalGhostBlock.startSlot === rowIndex;
                const hasInvalidMarker = invalidRanges.some((range) => (
                  range.columnIndex === columnIndex && rowIndex >= range.startSlot && rowIndex < range.endSlot
                ));
                const hasWarningMarker = warningRanges.some((range) => (
                  range.columnIndex === columnIndex && rowIndex >= range.startSlot && rowIndex < range.endSlot
                ));

                return (
                  <div
                    key={`${column}-${rowIndex}`}
                    className={[
                      'timetable-cell',
                      isHoveredColumn || isHoveredRow ? 'hover-highlight' : '',
                      isPreviewCell && previewRange?.mode === 'selection' ? 'selection-preview' : '',
                      isPreviewCell && ['move', 'resize', 'external'].includes(previewRange?.mode || '') ? 'move-preview' : '',
                      hasInvalidMarker ? 'planner-invalid-cell' : '',
                      hasWarningMarker ? 'planner-warning-cell' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => updatePointerState(columnIndex, rowIndex, activeBlock)}
                    onDragEnter={(event) => {
                      if (!externalDragActive) return;
                      event.preventDefault();
                      updateExternalPreview(columnIndex, rowIndex, activeBlock);
                    }}
                    onDragOver={(event) => {
                      if (!externalDragActive) return;
                      event.preventDefault();
                      try {
                        event.dataTransfer.dropEffect = 'copy';
                      } catch (error) {
                        // ignore unsupported dropEffect writes
                      }
                      updateExternalPreview(columnIndex, rowIndex, activeBlock);
                    }}
                    onDrop={(event) => {
                      if (!externalDragActive || !onDropDraftItem) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      if (activeBlock) {
                        onExternalPreviewChange?.(null);
                        return;
                      }
                      try {
                        const range = getExternalDropRange(rowIndex, timeSlots.length, externalDraggingDraft?.durationSlots);
                        onDropDraftItem({
                          classId: externalDraggingDraft.classId,
                          columnIndex,
                          startSlot: range.startRow,
                          endSlot: range.endRow,
                        });
                      } catch (error) {
                        console.error('timetable external drop failed', error);
                      } finally {
                        onExternalPreviewChange?.(null);
                      }
                    }}
                    onMouseDown={() => {
                      if (!editable || activeBlock || editableMode === 'view' || externalDragActive) {
                        return;
                      }
                      startSelection(columnIndex, rowIndex);
                    }}
                  >
                    {blockStart ? (
                      <TimetableBlock
                        block={blockStart}
                        isSourceDragging={Boolean(dragState && dragState.block.key === blockStart.key)}
                        suppressClick={suppressClick}
                        onClick={() => blockStart.onClick?.(blockStart)}
                        onDiscard={() => onDiscardBlock?.({ block: blockStart })}
                        onResizeStart={(edge) => startResize(blockStart, edge)}
                        onMouseDown={(event) => {
                          if (!editable || !blockStart.editable) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          startDrag(blockStart);
                        }}
                      />
                    ) : null}

                    {ghostStartsHere ? (
                      <TimetableBlock
                        block={ghostBlock}
                        isGhost
                        suppressClick
                      />
                    ) : null}

                    {externalGhostStartsHere ? (
                      <TimetableBlock
                        block={externalGhostBlock}
                        isGhost
                        suppressClick
                      />
                    ) : null}
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
