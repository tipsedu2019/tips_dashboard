import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  slotHeight = 48,
  density = 'comfortable',
}) {
  const blockRef = useRef(null);
  const tooltipRef = useRef(null);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [tooltipLayout, setTooltipLayout] = useState({ top: 0, left: 0, placement: 'top' });

  const classNames = [
    'timetable-block',
    'is-' + density,
    block.clickable && !isGhost ? 'clickable' : '',
    block.editable ? 'editable' : '',
    isGhost ? 'ghost' : '',
    isSourceDragging ? 'drag-source' : '',
    block.warning ? 'warning' : '',
  ].filter(Boolean).join(' ');

  const updateTooltipLayout = useCallback(() => {
    if (!block.tooltip || !blockRef.current || !tooltipRef.current || typeof window === 'undefined') {
      return;
    }

    const gap = 10;
    const viewportPadding = 12;
    const blockRect = blockRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const available = {
      top: blockRect.top - viewportPadding,
      bottom: window.innerHeight - blockRect.bottom - viewportPadding,
      left: blockRect.left - viewportPadding,
      right: window.innerWidth - blockRect.right - viewportPadding,
    };

    let placement = 'top';
    if (available.top >= tooltipRect.height + gap) {
      placement = 'top';
    } else if (available.bottom >= tooltipRect.height + gap) {
      placement = 'bottom';
    } else if (available.right >= tooltipRect.width + gap) {
      placement = 'right';
    } else if (available.left >= tooltipRect.width + gap) {
      placement = 'left';
    } else {
      placement = available.bottom >= available.top ? 'bottom' : 'top';
    }

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    let top = 0;
    let left = 0;

    if (placement === 'top' || placement === 'bottom') {
      left = clamp(
        blockRect.left + blockRect.width / 2 - tooltipRect.width / 2,
        viewportPadding,
        window.innerWidth - tooltipRect.width - viewportPadding
      );
      top = placement === 'top'
        ? blockRect.top - tooltipRect.height - gap
        : blockRect.bottom + gap;
    } else {
      top = clamp(
        blockRect.top + blockRect.height / 2 - tooltipRect.height / 2,
        viewportPadding,
        window.innerHeight - tooltipRect.height - viewportPadding
      );
      left = placement === 'right'
        ? blockRect.right + gap
        : blockRect.left - tooltipRect.width - gap;
    }

    setTooltipLayout({ top, left, placement });
  }, [block.tooltip]);

  useEffect(() => {
    if (!isTooltipOpen) {
      return undefined;
    }

    updateTooltipLayout();
    const syncTooltip = () => updateTooltipLayout();
    window.addEventListener('resize', syncTooltip);
    window.addEventListener('scroll', syncTooltip, true);
    return () => {
      window.removeEventListener('resize', syncTooltip);
      window.removeEventListener('scroll', syncTooltip, true);
    };
  }, [isTooltipOpen, updateTooltipLayout]);

  const openTooltip = () => {
    if (block.tooltip && !isGhost) {
      setIsTooltipOpen(true);
    }
  };

  const closeTooltip = () => {
    setIsTooltipOpen(false);
  };

  return (
    <>
      <div
        ref={blockRef}
        className={classNames}
        onClick={block.clickable && !isGhost && !suppressClick ? onClick : undefined}
        onMouseDown={isGhost ? undefined : onMouseDown}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        title={!block.editable && !isGhost && block.editableReason ? block.editableReason : undefined}
        style={{
          backgroundColor: block.backgroundColor || 'var(--bg-surface)',
          borderLeftColor: block.borderColor || 'var(--border-color)',
          color: block.textColor || 'var(--text-primary)',
          height: String((block.endSlot - block.startSlot) * slotHeight - 2) + 'px',
          position: 'relative',
          cursor: isGhost ? 'grabbing' : block.editable ? 'grab' : block.clickable ? 'pointer' : 'default',
        }}
      >
        {block.variantDot ? (
          <span className="block-variant-dot" title={block.variantDotTitle || "\uC2DC\uAC04\uD45C \uBC30\uCE58 \uBCC0\uACBD\uC774 \uC788\uC2B5\uB2C8\uB2E4."} />
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
            title="\uBC30\uCE58 \uCDE8\uC18C"
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
              title="\uC2DC\uC791 \uC2DC\uAC04 \uC870\uC815"
            />
            <button
              type="button"
              className="timetable-resize-handle bottom"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onResizeStart?.('end');
              }}
              title="\uC885\uB8CC \uC2DC\uAC04 \uC870\uC815"
            />
          </>
        ) : null}

        {block.header ? <div className="block-subject">{block.header}</div> : null}
        <div className="block-name">{block.title}</div>
        {(block.detailLines || []).map((line, index) => (
          <div
            key={block.key + '-detail-' + index}
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
      </div>

      {block.tooltip && isTooltipOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tooltipRef}
              className={'timetable-floating-tooltip is-' + tooltipLayout.placement}
              style={{
                top: tooltipLayout.top,
                left: tooltipLayout.left,
              }}
            >
              {block.tooltip}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function clampRange(startRow, endRow) {
  const min = Math.min(startRow, endRow);
  const max = Math.max(startRow, endRow);
  return { startRow: min, endRow: max + 1 };
}

function buildRangeKeySet(ranges = []) {
  const keys = new Set();
  ranges.forEach((range) => {
    for (let row = range.startSlot; row < range.endSlot; row += 1) {
      keys.add(`${range.columnIndex}-${row}`);
    }
  });
  return keys;
}

function formatPreviewLabel(columns, timeSlots, previewRange) {
  if (!previewRange) {
    return '';
  }

  const start = timeSlots[previewRange.startRow]?.split('-')[0] || '09:00';
  const end = timeSlots[previewRange.endRow - 1]?.split('-')[1] || '09:30';
  const columnLabel = columns[previewRange.columnIndex] || '';
  return `${columnLabel} / ${start} ~ ${end}`;
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

function TimetableGrid({
  columns,
  timeSlots,
  blocks,
  gridKey = null,
  slotOffset = 0,
  timeColumnWidth = 108,
  minColumnWidth = 90,
  timeLabel = '\uC2DC\uAC04',
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
  sharedDragState = null,
  onSharedDragStart,
  onSharedDragUpdate,
  slotHeight = 48,
  density = 'comfortable',
  shellClassName = '',
}) {
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [selectionState, setSelectionState] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const [suppressClick, setSuppressClick] = useState(false);

  const externalDragActive = Boolean(externalDraggingDraft?.classId);
  const sharedDragEnabled = Boolean(gridKey !== null && onSharedDragStart && onSharedDragUpdate);
  const activeDragState = sharedDragEnabled ? sharedDragState : dragState;
  const dragPreviewState =
    activeDragState && (!sharedDragEnabled || activeDragState.targetGridKey === gridKey)
      ? activeDragState
      : null;

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

  const invalidCellKeys = useMemo(() => buildRangeKeySet(invalidRanges), [invalidRanges]);
  const warningCellKeys = useMemo(() => buildRangeKeySet(warningRanges), [warningRanges]);

  const previewRange = useMemo(() => {
    if (resizeState?.columnIndex !== undefined) {
      return {
        mode: 'resize',
        columnIndex: resizeState.columnIndex,
        startRow: resizeState.startRow,
        endRow: resizeState.endRow,
      };
    }

    if (dragPreviewState?.targetColumnIndex !== undefined) {
      return {
        mode: 'move',
        columnIndex: dragPreviewState.targetColumnIndex,
        startRow: dragPreviewState.targetStartSlot,
        endRow: dragPreviewState.targetStartSlot + dragPreviewState.blockDuration,
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
  }, [dragPreviewState, externalPreviewRange, resizeState, selectionState]);

  const ghostBlock = useMemo(() => {
    if (!dragPreviewState) {
      return null;
    }

    const moved =
      dragPreviewState.block.columnIndex !== dragPreviewState.targetColumnIndex ||
      dragPreviewState.block.startSlot !== dragPreviewState.targetStartSlot;

    if (!moved) {
      return null;
    }

    return {
      ...dragPreviewState.block,
      key: `${dragPreviewState.block.key}-ghost`,
      columnIndex: dragPreviewState.targetColumnIndex,
      startSlot: dragPreviewState.targetStartSlot,
      endSlot: dragPreviewState.targetStartSlot + dragPreviewState.blockDuration,
      clickable: false,
      editable: false,
    };
  }, [dragPreviewState]);

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

  const handlePointerUp = useCallback(() => {
    if (selectionState) {
      try {
        if (onCreateSelection) {
          onCreateSelection({
            columnIndex: selectionState.columnIndex,
            startSlot: selectionState.startRow + slotOffset,
            endSlot: selectionState.endRow + slotOffset,
            gridKey,
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
            startSlot: resizeState.startRow + slotOffset,
            endSlot: resizeState.endRow + slotOffset,
            gridKey,
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
            startSlot: dragState.targetStartSlot + slotOffset,
            gridKey,
          });
          setSuppressClick(true);
          window.setTimeout(() => setSuppressClick(false), 0);
        }
      } catch (error) {
        console.error('timetable move failed', error);
      }

      setDragState(null);
    }
  }, [dragState, gridKey, onCreateSelection, onMoveBlock, onResizeBlock, resizeState, selectionState, slotOffset]);

  useEffect(() => {
    const clearTransientState = () => {
      handlePointerUp();
    };

    window.addEventListener('mouseup', clearTransientState);
    return () => window.removeEventListener('mouseup', clearTransientState);
  }, [handlePointerUp]);

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

    if (sharedDragEnabled) {
      onSharedDragStart({
        gridKey,
        block,
      });
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

    if (activeDragState) {
      const maxStart = Math.max(0, timeSlots.length - activeDragState.blockDuration);
      const nextStartSlot = Math.min(Math.max(rowIndex, 0), maxStart);

      if (sharedDragEnabled) {
        onSharedDragUpdate({
          gridKey,
          columnIndex,
          rowIndex: nextStartSlot,
        });
      } else {
        setDragState((current) => {
          if (!current) return current;
          return {
            ...current,
            targetColumnIndex: columnIndex,
            targetStartSlot: nextStartSlot,
          };
        });
      }
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
      className={['timetable-grid-shell', `is-${density}`, shellClassName].filter(Boolean).join(' ')}
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
            ? '\uC120\uD0DD \uBC94\uC704'
            : previewRange?.mode === 'resize'
              ? '\uD06C\uAE30 \uC870\uC808'
              : previewRange?.mode === 'external'
                ? '\uC0C8 \uBC30\uCE58'
                : '\uC774\uB3D9 \uC608\uC815'} / {previewLabel}
        </div>
      ) : null}

      <div
        className="timetable-grid"
        style={{ gridTemplateColumns: `${timeColumnWidth}px repeat(${columns.length}, minmax(${minColumnWidth}px, 1fr))` }}
      >
        <div className={['timetable-header-cell', crosshairEnabled && hoveredSlot ? 'hover-highlight' : ''].filter(Boolean).join(' ')}>
          {timeLabel}
        </div>
        {columns.map((column, columnIndex) => (
          <div
            key={column}
            className={['timetable-header-cell', crosshairEnabled && hoveredSlot?.col === columnIndex ? 'hover-highlight' : ''].filter(Boolean).join(' ')}
          >
            {column}
          </div>
        ))}

        {timeSlots.map((time, rowIndex) => {
          return (
            <div style={{ display: 'contents' }} key={time}>
              <div
                className={[
                  'timetable-time-cell',
                  crosshairEnabled && hoveredSlot && rowIndex >= hoveredSlot.startRow && rowIndex < hoveredSlot.endRow
                    ? 'hover-highlight'
                    : '',
                ].filter(Boolean).join(' ')}
                style={{ fontWeight: 500, height: slotHeight }}
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
                const hasInvalidMarker = invalidCellKeys.has(`${columnIndex}-${rowIndex}`);
                const hasWarningMarker = warningCellKeys.has(`${columnIndex}-${rowIndex}`);

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
                    style={{ height: slotHeight }}
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
                          startSlot: range.startRow + slotOffset,
                          endSlot: range.endRow + slotOffset,
                          gridKey,
                        });
                      } catch (error) {
                        console.error('timetable external drop failed', error);
                      } finally {
                        onExternalPreviewChange?.(null);
                      }
                    }}
                    onMouseDown={() => {
                      if (!editable || activeBlock || editableMode !== 'edit' || externalDragActive) {
                        return;
                      }
                      startSelection(columnIndex, rowIndex);
                    }}
                  >
                    {blockStart ? (
                      <TimetableBlock
                        block={blockStart}
                        isSourceDragging={
                          sharedDragEnabled
                            ? Boolean(sharedDragState && sharedDragState.sourceGridKey === gridKey && sharedDragState.block.key === blockStart.key)
                            : Boolean(dragState && dragState.block.key === blockStart.key)
                        }
                        slotHeight={slotHeight}
                        density={density}
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
                        slotHeight={slotHeight}
                        density={density}
                        suppressClick
                      />
                    ) : null}

                    {externalGhostStartsHere ? (
                      <TimetableBlock
                        block={externalGhostBlock}
                        isGhost
                        slotHeight={slotHeight}
                        density={density}
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

export default memo(TimetableGrid);
