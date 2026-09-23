'use client';
import { TimetablePlanRecoveryActions } from './timetable-plan-recovery-actions';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type ComponentType, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ImageDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { WorkspaceTabs, WorkspaceTabsList, WorkspaceTabsTrigger, WorkspaceTabsPanel } from '@/components/ui/workspace-tabs';
import { DataTableFilterPanel } from '@/components/data-table/data-table-filter-panel';
import { TimetableTransferDialog } from './timetable-transfer-dialog';
import { TimetablePlanClassList } from './timetable-plan-class-list';
import { TimetableTargetFilter } from './timetable-target-filter';
import { TimetablePlacementEditor, type PlacementEditorDraft } from './timetable-placement-editor';
import { buildPlanPanels, blankPlanItem, createPointerSession, finishPointerSession, formatPlanTime, itemDraft, PLAN_DAYS, PLAN_DAY_ORDER, PLAN_VIEWS, placementEdit, validatePlacementEdit, planErrorLabel, type PlanGridBlock } from './timetable-plan-interaction';
import { resolveGridTarget } from './timetable-placement-adapter';
import type { GridTarget, PlanItemDraft, TimetableView, TransferRequest, TransferResult } from './timetable-plan-contract';
import type { useTimetablePlan } from './use-timetable-plan';
import { getTimetablePanelLayout } from './timetable-layout';
import { exportElementAsImage } from '@/lib/export-as-image';
import Grid from './components/legacy-timetable-grid.jsx';
import styles from './timetable-grid-skin.module.css';
const LegacyGrid = Grid as unknown as ComponentType<Record<string, unknown>>;
type PointerStart = {
    kind: 'move' | 'resize' | 'range';
    slotId?: string;
    target: GridTarget;
} | {
    kind: 'drop';
    itemId: string;
};
type Preview = {
    panelKey: string;
    columnKey: string;
    startMinute: number;
    endMinute: number;
};
/** Keep the measured full grid height while the browser skips offscreen paint/layout. */
function TimetableRenderPanel({ children, forceVisible }: { children: ReactNode; forceVisible: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = useState<number | null>(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const observer = new ResizeObserver(entries => {
            const measured = entries[0]?.contentRect.height;
            if (measured > 0) setHeight(measured);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    return <div ref={ref} data-plan-render-panel className="min-w-0 p-3" style={{
        contentVisibility: forceVisible || height === null ? 'visible' : 'auto',
        containIntrinsicBlockSize: height === null ? undefined : `auto ${height}px`,
    }}>{children}</div>;
}
type PointerFeedbackControl = { show: (preview: Preview | null, error?: string) => void };
/** Pointer feedback updates without reconciling the unchanged class list and grids. */
function TimetablePointerFeedback({ control, panelRefs, visibleStartMinute, slotHeight }: {
    control: RefObject<PointerFeedbackControl | null>;
    panelRefs: RefObject<Record<string, HTMLDivElement | null>>;
    visibleStartMinute: number; slotHeight: number;
}) {
    const [feedback, setFeedback] = useState<{ preview: Preview | null; error: string }>({ preview: null, error: '' });
    useImperativeHandle(control, () => ({ show: (preview, error = '') => setFeedback({ preview, error }) }), []);
    const { preview, error } = feedback;
    const panel = preview ? panelRefs.current[preview.panelKey] : null;
    const column = preview && panel ? Array.from(panel.querySelectorAll<HTMLElement>('[data-plan-column]')).find(node =>
        (JSON.parse(node.dataset.planColumn!) as GridTarget).columnKey === preview.columnKey) : null;
    return <>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}{preview && column ? createPortal(
        <div data-plan-pointer-preview aria-hidden="true" className="pointer-events-none absolute left-0 right-0 border-2 border-primary bg-primary/10"
            style={{ top: (preview.startMinute - visibleStartMinute) / 30 * slotHeight, height: (preview.endMinute - preview.startMinute) / 30 * slotHeight }} />, column) : null}</>;
}
export function TimetablePlanWorkspace({ state, view, onViewChange, onEditorDirty, onTransferDirty, requestAction, onTransferred }: {
    onTransferred: (result: TransferResult, request: TransferRequest) => Promise<void>;
    state: ReturnType<typeof useTimetablePlan>;
    view: TimetableView;
    onViewChange: (view: TimetableView) => void;
    onEditorDirty: (dirty: boolean) => void;
    onTransferDirty: (dirty: boolean) => void;
    requestAction: (action: () => void) => void;
}) {
    const snapshot = state.draft;
    const onTransferPending = useCallback((pending: boolean) => { setTransferPending(pending); onTransferDirty(pending); }, [onTransferDirty]);
    // Each plan owns only its editor/transfer guards; picker continuations live above it.
    useEffect(() => () => { onEditorDirty(false); onTransferDirty(false); }, [onEditorDirty, onTransferDirty]);
    const [returnToTransfer, setReturnToTransfer] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false), [transferPending, setTransferPending] = useState(false);
    const [subject, setSubject] = useState(''), [targets, setTargets] = useState<Record<string, string[]>>({}), [gridCount, setGridCount] = useState(2), [axisMode, setAxisMode] = useState('default');
    const [search, setSearch] = useState(''), [listFilter, setListFilter] = useState('all'), [selectedItemIds, setSelectedItemIds] = useState<string[]>([]), [activeItemId, setActiveItemId] = useState<string | null>(null), [listOpen, setListOpen] = useState(true), [sheetOpen, setSheetOpen] = useState(false);
    const [editor, setEditor] = useState<PlacementEditorDraft | null>(null), [detail, setDetail] = useState<PlanGridBlock | null>(null), [deleteId, setDeleteId] = useState<string | null>(null), [error, setError] = useState(''), [dragging, setDragging] = useState(false), [exporting, setExporting] = useState('');
    const [exportStamp, setExportStamp] = useState('');
    const pointerFeedback = useRef<PointerFeedbackControl | null>(null);
    const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const cleanupPointer = useRef<(() => void) | null>(null);
    const suppressClick = useRef(false);
    const cleanupReleaseSuppression = useRef<(() => void) | null>(null);
    const frozenAxis = useRef({ start: 540, end: 1440 });
    const canEdit = !transferPending && !!snapshot?.permissions.canEdit && snapshot.plan.state === 'draft' && state.referenceStatus === 'verified';
    const allSlots = snapshot ? [...snapshot.slots, ...snapshot.shadowSlots] : [];
    const axisStart = axisMode === 'full' ? 0 : Math.min(540, ...allSlots.map(s => Math.floor(s.startMinute / 30) * 30));
    const axisEnd = 1440;
    if (!dragging && state.saveState !== 'saving')
        frozenAxis.current = { start: axisStart, end: axisEnd };
    const visibleStartMinute = dragging || state.saveState === 'saving' ? frozenAxis.current.start : axisStart, visibleEndMinute = dragging || state.saveState === 'saving' ? frozenAxis.current.end : axisEnd;
    const panels = useMemo(() => snapshot ? buildPlanPanels(snapshot, view, subject, targets[view] || []) : [], [snapshot, view, subject, targets]);
    const layout = getTimetablePanelLayout({ view, gridCount });
    useEffect(() => () => { cleanupPointer.current?.(); cleanupReleaseSuppression.current?.(); }, []);
    // Snapshot/filter changes cancel the gesture, but Escape still owns its later physical release.
    useEffect(() => { cleanupPointer.current?.(); }, [snapshot, view, subject, targets, gridCount, canEdit]);
    useEffect(() => { if (snapshot)
        setSelectedItemIds(ids => ids.filter(id => snapshot.items.some(item => item.id === id && item.state === 'draft'))); }, [snapshot]);
    const openEditor = useCallback((draft: PlacementEditorDraft) => requestAction(() => { setEditor({ ...draft, revision: state.controller?.snapshot().snapshot?.items.find(i => i.id === draft.item.id)?.revision ?? null }); setDetail(null); }), [requestAction, state.controller]);
    const closeEditor = (saved = false) => { const close = () => { setEditor(null); onEditorDirty(false); if (returnToTransfer) { setReturnToTransfer(false); setTransferOpen(true); } }; if (saved)
        close();
    else
        requestAction(close); };
    const save = async (edit: Parameters<typeof state.dispatch>[0]) => { if (snapshot)
        validatePlacementEdit(snapshot, edit); const itemId = edit.operation === 'save' ? edit.item.id : edit.itemId; if (state.failureKind(itemId) === 'rejected')
        await state.replaceRejected(edit);
    else if (editor?.item.id === itemId && state.controller)
        await state.controller.dispatch(edit, editor.revision);
    else
        await state.dispatch(edit); };
    const dispatch = async (edit: Parameters<typeof save>[0]) => { setError(''); try {
        await save(edit);
    }
    catch (e) {
        setError(planErrorLabel(e));
        throw e;
    } };
    const applyPlacement = (intent: Parameters<typeof placementEdit>[1]) => { if (!snapshot || !canEdit)
        return; try {
        void dispatch(placementEdit(snapshot, intent)).catch(() => { });
    }
    catch (e) {
        setError(planErrorLabel(e));
    } };
    const cell = (target: GridTarget, endMinute?: number) => { if (!snapshot || !canEdit || suppressClick.current)
        return; const item = snapshot.items.find(i => i.id === activeItemId && i.state === 'draft'); openEditor({ item: item ? itemDraft(item) : blankPlanItem(snapshot.plan.id), slots: item ? snapshot.slots.filter(s => s.itemId === item.id) : [], target: resolveGridTarget(target), endMinute }); };
    const startPointer = (event: ReactPointerEvent<HTMLElement>, source: PointerStart) => {
        if (!snapshot || !canEdit || event.button !== 0 || cleanupPointer.current)
            return;
        cleanupReleaseSuppression.current?.();
        suppressClick.current = false;
        if (source.kind !== 'range') {
            event.preventDefault();
            event.stopPropagation();
        }
        const element = event.currentTarget;
        const pointerId = event.pointerId;
        const startX = event.clientX, startY = event.clientY;
        let moved = false;
        const hit = (x: number, y: number): GridTarget | null => { const node = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-plan-column]'); if (!node)
            return null; const base = JSON.parse(node.dataset.planColumn!) as GridTarget; const rect = node.getBoundingClientRect(); return { ...base, rowPosition: Math.min((1440 - base.visibleStartMinute) / 30, Math.max(0, (y - rect.top) / layout.slotHeight)) }; };
        const origin = source.kind === 'drop' ? null : hit(startX, startY) || source.target;
        let target = origin;
        frozenAxis.current = { start: visibleStartMinute, end: visibleEndMinute };
        setError('');
        setDragging(true);
        try {
            element.setPointerCapture(pointerId);
        }
        catch { }
        const end = (reason: string) => {
            const finalTarget = target;
            cleanup();
            suppressClick.current = true;
            if (reason === 'Escape') {
                // Escape may precede physical release by many event-loop turns.
                // Keep its later generated click from opening the editor.
                const release = (event: PointerEvent) => {
                    if (event.pointerId !== pointerId) return;
                    cleanupReleaseSuppression.current?.();
                    setTimeout(() => { suppressClick.current = false; }, 0);
                };
                cleanupReleaseSuppression.current = () => {
                    window.removeEventListener('pointerup', release, true);
                    window.removeEventListener('pointercancel', release, true);
                    cleanupReleaseSuppression.current = null;
                };
                window.addEventListener('pointerup', release, true);
                window.addEventListener('pointercancel', release, true);
            } else setTimeout(() => { suppressClick.current = false; }, 0);
            if (reason !== 'pointerup' || !finalTarget)
                return;
            try {
                if (source.kind === 'move' && origin) {
                    const intent = finishPointerSession({ ...createPointerSession(source.slotId!, origin), target: finalTarget }, reason);
                    if (intent)
                        applyPlacement(intent);
                }
                else if (source.kind === 'resize' && origin) {
                    const slot = snapshot.slots.find(s => s.id === source.slotId);
                    if (slot && moved) {
                        const delta = Math.round(((finalTarget.visibleStartMinute + finalTarget.rowPosition * 30) - (origin.visibleStartMinute + origin.rowPosition * 30)) / 5) * 5;
                        applyPlacement({ kind: 'resize', slotId: slot.id, endMinute: slot.endMinute + delta });
                    }
                }
                else if (source.kind === 'drop' && moved) {
                    const item = snapshot.items.find(i => i.id === source.itemId);
                    if (item) {
                        try {
                            const edit = placementEdit(snapshot, { kind: 'drop', itemId: item.id, slotId: crypto.randomUUID(), target: finalTarget });
                            void dispatch(edit).catch(() => { });
                        }
                        catch {
                            openEditor({ item: itemDraft(item), slots: snapshot.slots.filter(s => s.itemId === item.id), target: resolveGridTarget(finalTarget) });
                        }
                    }
                }
                else if (source.kind === 'range' && origin) {
                    const start = resolveGridTarget(moved ? { ...finalTarget, rowPosition: Math.min(source.target.rowPosition, finalTarget.rowPosition) } : source.target);
                    const endMinute = moved ? Math.min(1440, Math.max(start.startMinute + 30, Math.round((finalTarget.visibleStartMinute + Math.max(source.target.rowPosition, finalTarget.rowPosition) * 30) / 5) * 5)) : undefined;
                    const item = snapshot.items.find(i => i.id === activeItemId && i.state === 'draft');
                    openEditor({ item: item ? itemDraft(item) : blankPlanItem(snapshot.plan.id), slots: item ? snapshot.slots.filter(s => s.itemId === item.id) : [], target: start, endMinute });
                }
            }
            catch (e) {
                setError(planErrorLabel(e));
            }
        };
        const move = (e: PointerEvent) => { if (e.pointerId !== pointerId)
            return; moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) > 4; target = hit(e.clientX, e.clientY); if (!target) {
            pointerFeedback.current?.show(null);
            return;
        } let minute = resolveGridTarget({ ...target, rowPosition: Math.min(target.rowPosition, (1435 - target.visibleStartMinute) / 30) }).startMinute; let duration = 60; if (source.kind === 'move' || source.kind === 'resize') {
            const slot = snapshot.slots.find(s => s.id === source.slotId);
            if (slot && origin) {
                const delta = Math.round((target.visibleStartMinute + target.rowPosition * 30 - origin.visibleStartMinute - origin.rowPosition * 30) / 5) * 5;
                minute = source.kind === 'move' ? slot.startMinute + delta : slot.startMinute;
                duration = slot.endMinute - slot.startMinute + (source.kind === 'resize' ? delta : 0);
            }
        } if (source.kind === 'drop')
            duration = snapshot.items.find(i => i.id === source.itemId)?.durationMinutes || 60; const nextPreview = { panelKey: target.panelKey, columnKey: target.columnKey, startMinute: Math.max(0, minute), endMinute: Math.min(1440, minute + duration) }; let pointerError = ''; try {
            if (source.kind === 'move' && origin)
                validatePlacementEdit(snapshot, placementEdit(snapshot, { kind: 'move', slotId: source.slotId!, origin, target }));
            else if (source.kind === 'drop')
                validatePlacementEdit(snapshot, placementEdit(snapshot, { kind: 'drop', itemId: source.itemId, slotId: 'preview', target }));
            else if (source.kind === 'resize')
                validatePlacementEdit(snapshot, placementEdit(snapshot, { kind: 'resize', slotId: source.slotId!, endMinute: minute + duration }));
        }
        catch (e) {
            pointerError = planErrorLabel(e);
        } pointerFeedback.current?.show(nextPreview, pointerError); };
        const up = (e: PointerEvent) => { if (e.pointerId === pointerId)
            end('pointerup'); };
        const cancel = (e: PointerEvent) => { if (e.pointerId === pointerId)
            end(e.type); };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') {
            e.preventDefault();
            end('Escape');
        } };
        const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); element.removeEventListener('lostpointercapture', cancel); cleanupPointer.current = null; setDragging(false); pointerFeedback.current?.show(null); try {
            if (element.hasPointerCapture(pointerId))
                element.releasePointerCapture(pointerId);
        }
        catch { } };
        cleanupPointer.current = cleanup;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', key);
        element.addEventListener('lostpointercapture', cancel);
    };
    if (!snapshot)
        return <div className="px-4 py-12 text-sm" role="status">{state.error ? <><span>프리셋을 불러오지 못했습니다.</span><Button variant="outline" onClick={() => void state.refresh()}>다시 시도</Button></> : '프리셋을 불러오는 중입니다.'}</div>;
    const targetLabel = view === 'teacher-weekly' ? '선생님' : view === 'classroom-weekly' ? '강의실' : '요일';
    const resourceOptions = view === 'teacher-weekly' ? snapshot.catalogs.teachers : view === 'classroom-weekly' ? snapshot.catalogs.classrooms : PLAN_DAY_ORDER.map(i => ({ id: String(i), name: PLAN_DAYS[i] }));
    const classList = <TimetablePlanClassList snapshot={snapshot} search={search} setSearch={setSearch}
      listFilter={listFilter} setListFilter={setListFilter} selectedItemIds={selectedItemIds} setSelectedItemIds={setSelectedItemIds}
      activeItemId={activeItemId} canEdit={canEdit} onActivate={id=>{setActiveItemId(id);setSheetOpen(false);}}
      onEdit={draft=>{setSheetOpen(false);openEditor(draft);}} onDelete={setDeleteId}
      onDrag={(event,itemId)=>startPointer(event,{kind:'drop',itemId})} suppressClick={()=>suppressClick.current}/>;
    const exportPanel = async (id: string) => { const element = panelRefs.current[id]; if (!element || state.dirty || state.saveState === 'saving' || exporting || editor) {
        setError('편집을 저장하거나 닫은 뒤 이미지를 저장해 주세요.');
        return;
    } setExporting(id); const stamp = new Date().toLocaleString('ko-KR'); setExportStamp(stamp); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); try {
        const grid = element.querySelector<HTMLElement>('.timetable-grid');
        await exportElementAsImage(element, `${snapshot.plan.name}-${PLAN_VIEWS.find(v => v.id === view)?.label}-${stamp}`.replace(/[\\/:*?"<>|]/g, '-') + '.png', { width: Math.max(1123, element.scrollWidth, (grid?.scrollWidth || 0) + 24), padding: 0, scale: 3, backgroundColor: '#ffffff' });
    }
    catch (e) {
        setError(planErrorLabel(e));
    }
    finally {
        setExporting('');
        setExportStamp('');
    } };
    const recoveryActions = <TimetablePlanRecoveryActions operations={state.pendingOperations}
        onResolve={(id, choice) => { void state.refresh().then(() => state.resolveStale(id, choice)).then(() => setDeleteId(null)).catch(e => setError(planErrorLabel(e))); }}
        onDiscard={id => { void state.discardRejected(id).then(() => setDeleteId(null)).catch(e => setError(planErrorLabel(e))); }}
        onRetry={id => { void state.retry(id).then(() => setDeleteId(null)).catch(e => setError(planErrorLabel(e))); }} />;
    return <WorkspaceTabs value={view} onValueChange={v => { cleanupPointer.current?.(); onViewChange(v as TimetableView); }} className={`${styles.scope} space-y-4 px-4 pb-6 sm:px-5 lg:px-6`}><div className="overflow-hidden rounded-xl border bg-card"><div className="flex flex-wrap justify-between gap-3 border-b p-3"><WorkspaceTabsList aria-label="시간표 보기" className="grid grid-cols-2 md:flex">{PLAN_VIEWS.map(v => <WorkspaceTabsTrigger className="h-11 md:h-9" key={v.id} value={v.id}>{v.label}</WorkspaceTabsTrigger>)}</WorkspaceTabsList><div className="flex flex-wrap items-center gap-2"><span data-testid="plan-selection-count" className="text-sm">{selectedItemIds.length ? `선택 ${selectedItemIds.length}개` : snapshot.plan.state === 'archived' ? '보관됨 · 읽기 전용' : ''}</span><Button variant="outline" disabled={(!transferPending && state.referenceStatus !== 'verified') || !snapshot.permissions.canEdit || (!selectedItemIds.length && !transferPending) || state.dirty} onClick={() => { if (transferPending) setTransferOpen(true); else requestAction(() => setTransferOpen(true)); }}>{transferPending ? '전송 결과 확인' : '선택 이동·복사'}</Button><Button disabled={!canEdit} onClick={() => openEditor({ item: blankPlanItem(snapshot.plan.id), slots: [] })}>수업 추가</Button><Button variant="outline" className="hidden xl:inline-flex" onClick={() => setListOpen(!listOpen)}>수업 목록</Button><Button variant="outline" className="xl:hidden" onClick={() => setSheetOpen(true)}>수업 목록</Button></div></div><div className="p-3"><DataTableFilterPanel label="시간표 조건" activeFilters={subject ? [{ label: '과목', value: subject }] : []} onReset={() => { setSubject(''); setTargets({}); }} canReset={!!subject || Object.values(targets).some(v => v.length)}><div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-2"><Label htmlFor="plan-subject">과목</Label><Select value={subject || 'all'} onValueChange={v => setSubject(v === 'all' ? '' : v)}><SelectTrigger id="plan-subject"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">전체 과목</SelectItem>{[...new Set([...snapshot.items, ...snapshot.shadowClasses].map(i => i.subject).filter(Boolean))].map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}</SelectContent></Select></div><TimetableTargetFilter label={targetLabel} options={resourceOptions.map(r => r.id)} optionLabels={Object.fromEntries(resourceOptions.map(r => [r.id, r.name]))} selected={targets[view] || []} onChange={values => setTargets(current => ({ ...current, [view]: values }))}/><div className="space-y-2"><Label htmlFor="plan-hours">시간 범위</Label><Select value={axisMode} onValueChange={setAxisMode} disabled={dragging}><SelectTrigger id="plan-hours"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">09:00–24:00</SelectItem><SelectItem value="full">00:00–24:00</SelectItem></SelectContent></Select></div><div className="hidden space-y-2 xl:block"><Label htmlFor="plan-layout">배치</Label><Select value={String(gridCount)} onValueChange={v => setGridCount(Number(v))}><SelectTrigger id="plan-layout"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1단</SelectItem><SelectItem value="2">2단</SelectItem></SelectContent></Select></div></div></DataTableFilterPanel></div></div>
 <div className="flex flex-wrap items-center gap-2 text-sm" role="status"><span>{state.saveState === 'saving' ? '저장 중' : state.saveState === 'saved' ? '저장됨' : state.saveState === 'stale' ? '최신 내용 확인 필요' : state.saveState === 'error' ? '저장 실패' : canEdit ? '편집 가능' : '읽기 전용'}</span>{state.referenceStatus !== 'verified' ? <span>운영 시간표 확인 필요</span> : null}{state.conflicts.length ? <span className="text-destructive">충돌 해결 필요 · {state.conflicts.length}건</span> : null}{state.dirty ? <Button size="sm" variant="outline" onClick={() => void state.retry().catch(e => setError(planErrorLabel(e)))}>재시도</Button> : null}<Button size="sm" variant="ghost" onClick={() => void state.refresh()}>새로고침</Button><Button size="sm" variant="ghost" disabled={!canEdit || state.saveState !== 'saved'} onClick={() => void state.undo().catch(e => setError(planErrorLabel(e)))}>실행 취소</Button>{recoveryActions}</div>{error || state.error ? <p role="alert" className="text-sm text-destructive">{error || planErrorLabel(state.error)}</p> : null}
 <TimetablePointerFeedback control={pointerFeedback} panelRefs={panelRefs} visibleStartMinute={visibleStartMinute} slotHeight={layout.slotHeight} />
 <WorkspaceTabsPanel aria-label={PLAN_VIEWS.find(v => v.id === view)?.label}><div className="flex items-start gap-4">{listOpen ? <aside aria-label="프리셋 수업 목록" className="hidden w-[280px] shrink-0 overflow-hidden rounded-xl border bg-card xl:block">{classList}</aside> : null}<div className="min-w-0 flex-1">{!panels.length ? <div className="rounded-xl border p-8 text-sm">{(view.includes('teacher') ? snapshot.catalogs.teachers : snapshot.catalogs.classrooms).length ? '조건에 맞는 패널이 없습니다.' : <>등록된 자원이 없습니다. <Button asChild variant="outline"><a href={view.includes('teacher') ? '/admin/settings/teachers' : '/admin/settings/classrooms'}>자원 설정</a></Button></>}</div> : <div className="grid grid-cols-1 gap-4 xl:[grid-template-columns:var(--timetable-panel-columns)]" style={{ '--timetable-panel-columns': `repeat(${Math.min(gridCount, panels.length)},minmax(0,1fr))` } as CSSProperties}>{panels.map(panel => <section key={panel.id} className="relative min-w-0 overflow-hidden rounded-xl border bg-card"><div ref={node => { panelRefs.current[panel.id] = node; }} className="min-w-0 bg-background"><div className="flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-3 pr-16"><h2 className="break-words text-base font-semibold">{panel.name}</h2><p className="text-xs text-muted-foreground">수업 {new Set(panel.blocks.map(b => b.itemId)).size}개</p></div>{exportStamp ? <p className="px-4 py-2 text-xs">{snapshot.plan.name} · {PLAN_VIEWS.find(v => v.id === view)?.label} · {exportStamp}</p> : null}<TimetableRenderPanel forceVisible={!!exportStamp}><LegacyGrid planGrid={{ panel, view, visibleStartMinute, visibleEndMinute, layout, editable: canEdit && !exportStamp, onCell: cell, onOpen: (block: PlanGridBlock) => { if (suppressClick.current)
            return; if (block.shadow)
            setDetail(block);
        else {
            const item = snapshot.items.find(i => i.id === block.itemId);
            if (item)
                openEditor({ item: itemDraft(item), slots: snapshot.slots.filter(s => s.itemId === item.id), slotId: block.id });
        } }, onPointerStart: startPointer }}/></TimetableRenderPanel></div><Button variant="ghost" size="icon" aria-label={`${panel.name} 이미지 저장`} disabled={!!exporting || state.dirty || state.saveState === 'saving'} onClick={() => void exportPanel(panel.id)} className="absolute right-2 top-2 size-11 sm:size-9"><ImageDown /></Button></section>)}</div>}</div></div></WorkspaceTabsPanel>
 <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>수업 목록</SheetTitle><SheetDescription>수업을 선택한 뒤 시간표의 셀 또는 편집 폼에서 배치합니다.</SheetDescription></SheetHeader>{classList}</SheetContent></Sheet>
 {editor ? <TimetablePlacementEditor key={editor.item.id + ':' + (editor.pendingResolutionId || editor.slotId || 'new') + ':' + JSON.stringify(editor.target)} draft={editor} snapshot={snapshot} loadScienceSubjectAreas={state.service?.listScienceSubjectAreas} onSave={save} onClose={closeEditor} onDirty={onEditorDirty} canEdit={canEdit} failureKind={state.failureKind(editor.item.id)} onRetry={async () => { await state.retry(editor.item.id); const current = state.controller?.snapshot().snapshot; setEditor(previous => previous ? { ...previous, revision: current?.items.find(i => i.id === previous.item.id)?.revision ?? null } : null); }} onDiscard={() => state.discardRejected(editor.item.id)} onAcceptServer={() => state.resolveStale(editor.item.id, 'accept_server')} serverSummary={`${state.snapshot?.items.find(i => i.id === editor.item.id)?.name || '삭제된 수업'} · ${state.snapshot?.slots.filter(s => s.itemId === editor.item.id).map(s => `${PLAN_DAYS[s.weekday]} ${formatPlanTime(s.startMinute)}–${formatPlanTime(s.endMinute)}`).join(', ')}`}/> : null}
 <Dialog open={!!detail} onOpenChange={open => { if (!open)
        setDetail(null); }}><DialogContent restoreFocusToOpener><DialogHeader><DialogTitle>{detail?.title}</DialogTitle><DialogDescription>기존 수업 · 운영 시간표에서 자리를 점유합니다.</DialogDescription></DialogHeader><p>{detail ? `${PLAN_DAYS[detail.slot.weekday]} ${formatPlanTime(detail.startMinute)}–${formatPlanTime(detail.endMinute)} · ${detail.teacher} · ${detail.classroom}` : ''}</p><DialogFooter><Button variant="outline" onClick={() => setDetail(null)}>닫기</Button><Button disabled={!canEdit} onClick={() => { if (!detail)
        return; const source = snapshot.shadowClasses.find(c => c.id === detail.itemId); const item: PlanItemDraft = { ...blankPlanItem(snapshot.plan.id), name: detail.title, subject: detail.subject, grade: source?.grade || '', defaultTeacherId: detail.slot.teacherId, defaultClassroomId: detail.slot.classroomId, durationMinutes: detail.endMinute - detail.startMinute }; openEditor({ item, slots: [] }); }}>이 수업으로 새 초안 만들기</Button></DialogFooter></DialogContent></Dialog>
 <Dialog open={!!deleteId} onOpenChange={open => { if (!open)
        setDeleteId(null); }}><DialogContent restoreFocusToOpener><DialogHeader><DialogTitle>프리셋 수업 삭제</DialogTitle><DialogDescription>이 수업과 모든 배치를 삭제합니다. 운영 수업은 변경되지 않습니다.</DialogDescription></DialogHeader><div>{deleteId && state.failureKind(deleteId) ? recoveryActions : null}</div><DialogFooter><Button variant="outline" onClick={() => setDeleteId(null)}>취소</Button><Button variant="destructive" disabled={!canEdit || !!(deleteId && state.pendingOperations.some(entry => entry.itemId === deleteId))} onClick={() => { if (deleteId)
        void dispatch({ operation: 'delete', itemId: deleteId }).then(() => { setSelectedItemIds(ids => ids.filter(id => id !== deleteId)); setDeleteId(null); }).catch(() => { }); }}>수업 삭제</Button></DialogFooter></DialogContent></Dialog>
 <TimetableTransferDialog key={state.service?.actorScope} open={transferOpen} onOpenChange={setTransferOpen} state={state} selectedItemIds={selectedItemIds} setSelectedItemIds={setSelectedItemIds} onPending={onTransferPending} onTransferred={onTransferred} onEditItem={itemId => { if (transferPending || !canEdit) return; const item = snapshot.items.find(row => row.id === itemId && row.state === 'draft'); if (!item) return; setTransferOpen(false); setReturnToTransfer(true); openEditor({ item: itemDraft(item), slots: snapshot.slots.filter(slot => slot.itemId === itemId), scope: 'item' }); }}/>
 </WorkspaceTabs>;
}
