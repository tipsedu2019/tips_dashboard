import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';

function formatSlotLabel(slotText) {
  return slotText?.split('-')[0] || '';
}

function buildVisibleRows(timeSlots, blocks, selectedIndex) {
  const rows = [];
  const selectedBlocks = blocks
    .filter((block) => block.columnIndex === selectedIndex)
    .sort((left, right) => left.startSlot - right.startSlot);
  const startMap = new Map(selectedBlocks.map((block) => [block.startSlot, block]));

  for (let slotIndex = 0; slotIndex < timeSlots.length; slotIndex += 1) {
    const coveringBlock = selectedBlocks.find(
      (block) => slotIndex >= block.startSlot && slotIndex < block.endSlot
    );

    if (coveringBlock && coveringBlock.startSlot !== slotIndex) {
      continue;
    }

    rows.push({
      slotIndex,
      block: startMap.get(slotIndex) || null,
      label: formatSlotLabel(timeSlots[slotIndex]),
    });
  }

  return rows;
}

export default function MobileAgendaTimetable({
  title,
  subtitle = '',
  options,
  selectedKey,
  onSelectKey,
  emptyMessage,
  blocks,
  timeSlots,
  editable = false,
  onCreateSelection,
  onMoveBlock,
  onBlockClick,
  dataTestId = '',
}) {
  const [moveModeBlockKey, setMoveModeBlockKey] = useState(null);
  const longPressTimer = useRef(null);

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.key === selectedKey)),
    [options, selectedKey]
  );

  const rows = useMemo(
    () => buildVisibleRows(timeSlots, blocks, selectedIndex),
    [blocks, selectedIndex, timeSlots]
  );

  const movingBlock = useMemo(
    () => rows.find((row) => row.block?.key === moveModeBlockKey)?.block || blocks.find((block) => block.key === moveModeBlockKey) || null,
    [blocks, moveModeBlockKey, rows]
  );

  const startLongPress = (block) => {
    if (!editable || !block?.editable) {
      return;
    }

    clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setMoveModeBlockKey(block.key);
    }, 420);
  };

  const stopLongPress = () => {
    clearTimeout(longPressTimer.current);
  };

  if (options.length === 0) {
    return (
      <div
        className="card-custom"
        style={{
          padding: 20,
          borderRadius: 22,
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="mobile-agenda-shell" data-testid={dataTestId || undefined} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="mobile-agenda-head" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="mobile-agenda-copy" style={{ display: 'grid', gap: subtitle ? 4 : 0 }}>
          <div className="mobile-agenda-title" style={{ fontSize: 16, fontWeight: 900 }}>{title}</div>
          {subtitle ? (
            <div className="mobile-agenda-subtitle" style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        <div
          className="mobile-agenda-option-rail"
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`h-segment-btn ${selectedKey === option.key ? 'active' : ''}`}
              onClick={() => onSelectKey(option.key)}
              style={{
                whiteSpace: 'nowrap',
                flex: '0 0 auto',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {movingBlock ? (
        <div
          className="mobile-agenda-move-banner"
          style={{
            padding: '9px 12px',
            borderRadius: 16,
            background: 'rgba(33, 110, 78, 0.08)',
            border: '1px solid rgba(33, 110, 78, 0.18)',
            color: 'var(--accent-color)',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          이동 모드입니다. 빈 시간칸을 눌러 옮기고, 다시 길게 누르면 취소됩니다.
        </div>
      ) : null}

      <div
        className="card-custom mobile-agenda-grid"
        style={{
          borderRadius: 22,
          overflow: 'hidden',
        }}
      >
        {rows.map((row) => {
          const block = row.block;

          return (
            <div
              key={`${selectedKey}-${row.slotIndex}`}
              className="mobile-agenda-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '58px minmax(0, 1fr)',
                gap: 10,
                padding: '8px 12px',
                alignItems: 'stretch',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div
                className="mobile-agenda-time"
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  paddingTop: 6,
                }}
              >
                {row.label}
              </div>

              {block ? (
                <button
                  type="button"
                  className="mobile-agenda-block"
                  onClick={() => onBlockClick?.(block)}
                  onPointerDown={() => startLongPress(block)}
                  onPointerUp={stopLongPress}
                  onPointerLeave={stopLongPress}
                  style={{
                    padding: 12,
                    borderRadius: 16,
                    border: `1px solid ${block.borderColor || 'rgba(0,0,0,0.08)'}`,
                    background: block.backgroundColor || 'var(--bg-surface-hover)',
                    color: block.textColor || 'var(--text-primary)',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: moveModeBlockKey === block.key ? '0 0 0 2px rgba(33, 110, 78, 0.18)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                    <div style={{ minWidth: 0 }}>
                      {block.header ? (
                        <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.9 }}>{block.header}</div>
                      ) : null}
                      <div style={{ marginTop: 2, fontSize: 14, fontWeight: 900, lineHeight: 1.28 }}>{block.title}</div>
                    </div>
                    {editable && block.editable ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 800,
                          opacity: 0.82,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        길게 눌러 이동
                        <ArrowRight size={12} />
                      </span>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {block.detailLines?.map((line) => (
                      <div key={`${block.key}-${line.label}`} style={{ fontSize: 11, lineHeight: 1.45, fontWeight: line.subtle ? 600 : 700, opacity: line.subtle ? 0.78 : 0.95 }}>
                        {line.value}
                      </div>
                    ))}
                  </div>
                </button>
              ) : editable ? (
                <button
                  type="button"
                  className="mobile-agenda-empty"
                  onClick={() => {
                    if (movingBlock) {
                      onMoveBlock?.({
                        block: movingBlock,
                        columnIndex: selectedIndex,
                        startSlot: row.slotIndex,
                      });
                      setMoveModeBlockKey(null);
                      return;
                    }

                    onCreateSelection?.({
                      columnIndex: selectedIndex,
                      startSlot: row.slotIndex,
                      endSlot: row.slotIndex + 1,
                    });
                  }}
                  style={{
                    minHeight: 56,
                    borderRadius: 16,
                    border: '1px dashed rgba(33, 110, 78, 0.18)',
                    background: movingBlock ? 'rgba(33, 110, 78, 0.08)' : 'transparent',
                    color: movingBlock ? 'var(--accent-color)' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <Plus size={16} />
                  {movingBlock ? '여기로 이동' : '빈 시간 추가'}
                </button>
              ) : (
                <div
                  className="mobile-agenda-empty-state"
                  style={{
                    minHeight: 56,
                    borderRadius: 16,
                    border: '1px dashed rgba(15, 23, 42, 0.08)',
                    background: 'transparent',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
