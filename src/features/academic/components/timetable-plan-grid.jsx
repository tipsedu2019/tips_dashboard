import { GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPlanTime, layoutOverlapLanes } from '../timetable-plan-interaction.ts';
/** Canonical minutes/IDs. The parent owns pointer lifetime and the one save queue. */
export function TimetablePlanGrid({ panel, view, visibleStartMinute, visibleEndMinute, layout, editable, onCell, onOpen, onPointerStart, preview, BlockComponent }) {
    const count = (visibleEndMinute - visibleStartMinute) / 30;
    const height = count * layout.slotHeight;
    const target = (columnKey, rowPosition) => ({ view, panelKey: panel.id, columnKey, visibleStartMinute, rowPosition, slotMinutes: 30 });
    return <div className={`timetable-grid-shell is-${layout.density} ${layout.fitColumns ? 'is-fit-columns' : ''}`} style={{ overflowX: 'auto', minWidth: 0, touchAction: 'pan-x pan-y' }}>
  <div className="timetable-grid" style={{ gridTemplateColumns: `${layout.timeColumnWidth}px repeat(${panel.columns.length},minmax(${layout.minColumnWidth}px,1fr))`, width: layout.fitColumns ? '100%' : undefined, minWidth: layout.fitColumns ? 'var(--timetable-fit-min-width, 0)' : undefined }}>
   <div className="timetable-header-cell">시간</div>{panel.columns.map(c => <div key={c.id} className="timetable-header-cell">{c.name}</div>)}
   <div style={{ height }}>{Array.from({ length: count }, (_, row) => <div key={row} className="timetable-time-cell" style={{ height: layout.slotHeight }}>{formatPlanTime(visibleStartMinute + row * 30)}–{formatPlanTime(visibleStartMinute + (row + 1) * 30)}</div>)}</div>
   {panel.columns.map(column => <div key={column.id} data-plan-column={JSON.stringify(target(column.id, 0))} style={{ height, position: 'relative' }}>
    {Array.from({ length: count }, (_, row) => <button key={row} type="button" className="timetable-cell w-full block text-left focus-visible:outline-2 focus-visible:outline-ring" style={{ height: layout.slotHeight }} aria-label={`${panel.name} ${column.name} ${formatPlanTime(visibleStartMinute + row * 30)} 배치`} disabled={!editable} onClick={() => onCell(target(column.id, row))} onPointerDown={event => { if (event.pointerType === 'mouse' && event.button === 0 && editable)
            onPointerStart(event, { kind: 'range', target: target(column.id, row) }); }}/>)}
    {layoutOverlapLanes(panel.blocks.filter(b => b.columnKey === column.id)).map(block => {
                const startSlot = (block.startMinute - visibleStartMinute) / 30, endSlot = (block.endMinute - visibleStartMinute) / 30;
                const metadata = { key: block.id, title: block.title, subject: block.shadow ? `${block.subject} · 기존 수업` : block.subject, startSlot, endSlot, clickable: true, editable: false, backgroundColor: block.shadow ? 'var(--tt-grid-surface-muted)' : 'var(--tt-block-bg-1)', borderColor: block.shadow ? 'var(--border)' : 'var(--tt-block-border-1)', textColor: block.shadow ? 'var(--foreground)' : 'var(--tt-block-text-1)', detailLines: [{ value: `${block.teacher} · ${block.classroom}` }], tooltipDetails: { title: block.title, schedule: `${formatPlanTime(block.startMinute)}–${formatPlanTime(block.endMinute)}`, teacher: block.teacher, classroom: block.classroom } };
                return <div key={block.id} data-plan-slot={block.id} data-shadow={block.shadow || undefined} style={{ position: 'absolute', top: startSlot * layout.slotHeight, left: `${block.lane / block.laneCount * 100}%`, width: `${100 / block.laneCount}%`, padding: 1 }}>
      <BlockComponent block={metadata} slotHeight={layout.slotHeight} density={layout.density} onClick={() => onOpen(block)}/>
      {editable && !block.shadow ? <><Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1 z-10 size-6" style={{ touchAction: 'none' }} aria-label={`${block.title} 이동`} data-plan-handle onPointerDown={event => onPointerStart(event, { kind: 'move', slotId: block.id, target: target(column.id, startSlot) })} onClick={() => onOpen(block)}><GripVertical className="size-3"/></Button><button type="button" className="absolute bottom-0 z-10 left-1 right-1 h-2 cursor-ns-resize focus-visible:outline-2 focus-visible:outline-ring" style={{ touchAction: 'none' }} data-plan-handle aria-label={`${block.title} 종료 시각 조정`} onPointerDown={event => onPointerStart(event, { kind: 'resize', slotId: block.id, target: target(column.id, endSlot) })} onClick={() => onOpen(block)}/></> : null}
     </div>;
            })}
    {preview && preview.panelKey === panel.id && preview.columnKey === column.id ? <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 border-2 border-primary bg-primary/10" style={{ top: (preview.startMinute - visibleStartMinute) / 30 * layout.slotHeight, height: (preview.endMinute - preview.startMinute) / 30 * layout.slotHeight }}/> : null}
   </div>)}
  </div>
 </div>;
}
