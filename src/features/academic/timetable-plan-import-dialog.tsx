'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { TimetablePlanService } from './timetable-plan-service';
import type { TimetableImportCommand, TimetableImportPreview, TimetableImportSource, TimetableImportSources } from './timetable-plan-contract';
import { availableTimetableSessionStorage, observeTimetableActorRetirement, timetableDraftStorageKey } from './timetable-plan-recovery';
import { formatLegacyImportLabel, planErrorLabel } from './timetable-plan-interaction';

/** One management-only first-entry copy. Pending placements use the existing editor. */
export function TimetablePlanImportDialog({ service, disabled, requestAction, onCommitted, onDirty }: {
    service: TimetablePlanService; disabled: boolean; requestAction: (action: () => void) => void;
    onCommitted: (id: string) => void; onDirty: (dirty: boolean) => void;
}) {
    const [open, setOpen] = useState(false), [sources, setSources] = useState<TimetableImportSources | null>(null);
    const [source, setSource] = useState<TimetableImportSource>({ kind: 'preparation', classIds: [] });
    const [name, setName] = useState(''), [preview, setPreview] = useState<TimetableImportPreview | null>(null);
    const [command, setCommand] = useState<TimetableImportCommand | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(false);
    const live = useRef(true), epoch = useRef(0);
    const key = timetableDraftStorageKey(service.actorScope, '$import');
    const persist = (intent: TimetableImportCommand | null) => {
        try {
            const storage = availableTimetableSessionStorage();
            if (!storage) throw Error('storage unavailable');
            if (intent) storage.setItem(key, JSON.stringify({ version: 1, command: intent })); else storage.removeItem(key);
            setStorageError(false);
        } catch { setStorageError(true); }
    };
    useEffect(() => {
        live.current = true;
        const lifetime = epoch;
        const stop = observeTimetableActorRetirement(service.actorScope, () => {
            epoch.current++; setOpen(false); setSources(null); setPreview(null); setCommand(null); setName(''); setError('');
        });
        try {
            const raw = availableTimetableSessionStorage()?.getItem(key);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved.version !== 1 || !saved.command?.requestKey || !saved.command?.sourceFingerprint || typeof saved.command?.name !== 'string') throw Error('invalid recovery');
                setCommand(saved.command); setSource(saved.command.source); setName(saved.command.name);
            }
        } catch { setStorageError(true); }
        return () => { live.current = false; lifetime.current++; stop(); };
    }, [key, service.actorScope]);
    useEffect(() => { onDirty(open || !!command); return () => onDirty(false); }, [open, command, onDirty]);
    const show = () => { const action = () => {
        setOpen(true); setError('');
        if (command) return;
        const token = ++epoch.current;
        void service.importSources().then(result => { if (live.current && token === epoch.current) setSources(result); })
            .catch(e => { if (live.current && token === epoch.current) setError(planErrorLabel(e)); });
    }; if (command) action(); else requestAction(action); };
    const inspect = async () => {
        const token = ++epoch.current; setBusy(true); setError('');
        try { const result = await service.previewImport(source); if (live.current && token === epoch.current) setPreview(result); }
        catch (e) { if (live.current && token === epoch.current) setError(planErrorLabel(e)); }
        finally { if (live.current && token === epoch.current) setBusy(false); }
    };
    const submit = async () => {
        if (busy || disabled || (!command && (!preview || !name.trim()))) return;
        const intent = command ?? { source: preview!.source, sourceFingerprint: preview!.sourceFingerprint, name: name.trim(), requestKey: crypto.randomUUID() };
        setCommand(intent); persist(intent); setBusy(true); setError(''); const token = ++epoch.current;
        try {
            const result = await service.commitImport(intent);
            if (!live.current || token !== epoch.current) return;
            persist(null); setCommand(null); setOpen(false); setPreview(null); onCommitted(result.plan.id);
        } catch (e) {
            if (!live.current || token !== epoch.current) return;
            const failure = e as { code?: string; message?: string };
            if ((failure.code === 'P0001' && failure.message === 'timetable_stale') || (failure.code === '22023' && ['timetable_invalid', 'timetable_capacity', 'timetable_import_metadata_missing'].includes(failure.message || ''))) {
                persist(null); setCommand(null); setPreview(null);
            }
            setError(planErrorLabel(e));
        } finally { if (live.current && token === epoch.current) setBusy(false); }
    };
    const choose = (next: TimetableImportSource) => { setSource(next); setPreview(null); };
    return <>
        <Button variant="outline" disabled={disabled} onClick={show}>{command ? '가져오기 요청 확인' : '기존 초안 가져오기'}</Button>
        <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); epoch.current++; } }}>
            <DialogContent restoreFocusToOpener>
                <DialogHeader><DialogTitle>새 프리셋으로 가져오기</DialogTitle><DialogDescription>선택한 수업의 기본정보와 배치를 복사합니다. 겹치거나 확인할 수 없는 배치는 미배치로 보존됩니다.</DialogDescription></DialogHeader>
                <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }}>
                    <div className="space-y-2"><Label htmlFor="import-plan-name">새 프리셋 이름</Label><Input id="import-plan-name" value={name} disabled={!!command || busy} onChange={e => setName(e.target.value)} maxLength={120} required /></div>
                    {!command ? <>
                        <Select value={source.kind} onValueChange={kind => choose(kind === 'legacy' ? { kind, key: '' } : { kind: 'preparation', classIds: [] })} disabled={busy}>
                            <SelectTrigger aria-label="가져올 원본"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="preparation">개강 준비 수업</SelectItem><SelectItem value="legacy">이전 시간표 초안</SelectItem></SelectContent>
                        </Select>
                        <div className="max-h-64 space-y-2 overflow-y-auto">
                            {source.kind === 'preparation' ? sources?.preparationClasses.map(c => <label key={c.id} className="flex items-center gap-2 text-sm"><Checkbox disabled={busy} checked={source.classIds.includes(c.id)} onCheckedChange={checked => choose({ kind: 'preparation', classIds: checked ? [...source.classIds, c.id] : source.classIds.filter(id => id !== c.id) })} />{c.name} · {c.subject}</label>) : sources?.legacyCandidates.map((c, index) => <label key={c.key} className="flex items-center gap-2 text-sm"><input type="radio" name="legacy-source" disabled={busy || c.parseStatus !== 'ready' || !c.entryCount} checked={source.key === c.key} onChange={() => choose({ kind: 'legacy', key: c.key })} /><span className="min-w-0 break-words">{formatLegacyImportLabel(c.key, index)} · {c.entryCount}개 · <span className="whitespace-nowrap">{c.parseStatus === 'ready' ? c.updatedAt.slice(0, 10) : '형식 확인 필요'}</span></span></label>)}
                            {sources && !(source.kind === 'preparation' ? sources.preparationClasses.length : sources.legacyCandidates.length) ? <p className="text-sm text-muted-foreground">가져올 원본이 없습니다.</p> : null}
                        </div>
                        <Button type="button" variant="outline" disabled={busy || (source.kind === 'preparation' ? !source.classIds.length : !source.key)} onClick={() => void inspect()}>선택한 원본 확인</Button>
                        {preview ? <ul className="max-h-48 overflow-y-auto text-sm">{preview.entries.map((entry, index) => <li key={index}>{entry.name} · 배치 {entry.scheduleLines.length}개</li>)}</ul> : null}
                    </> : <p role="status" className="text-sm">제출한 가져오기 요청의 결과를 먼저 확인합니다.</p>}
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    {storageError ? <p role="alert" className="text-sm text-destructive">복구 정보를 저장할 수 없습니다. 결과 확인 전에는 새로고침하지 마세요.</p> : null}
                    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>취소</Button><Button disabled={disabled || busy || (!command && !preview)}>{busy ? '확인 중…' : command ? '원래 요청 재시도' : '새 프리셋으로 가져오기'}</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    </>;
}
