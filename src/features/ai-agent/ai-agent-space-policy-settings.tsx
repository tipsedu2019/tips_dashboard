'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { ActionFeedback } from '@/components/ui/action-feedback';
import { SettingsMasterHeader, SettingsWorkspaceShell } from '@/features/management/settings-master-layout';
import { useDraftNavigation } from '@/hooks/use-draft-navigation';
import { type AiRequestActor } from './ai-agent-request-access';
import { type AiSpaceCatalog, type AiSpacePermission, aiRequestErrorMessage } from './ai-agent-request-service';
import { readAiRequestDraft, writeAiRequestDraft, deleteAiRequestDraft, getAiRequestAttempt } from './ai-agent-request-recovery';
import { useAiAgentRequestActorBoundary, useAiAgentRequestService, type AiRequestBoundary } from './use-ai-agent-requests';
type Person = {
    id: string;
    name: string | null;
    role: string;
};
export function AiAgentSpacePolicySettings() {
    const boundary = useAiAgentRequestActorBoundary();
    if (boundary.loading)
        return <SettingsWorkspaceShell>
        <p role="status">권한 확인 중…</p>
        </SettingsWorkspaceShell>;
    if (!boundary.actor || !boundary.access.canViewAll)
        return <SettingsWorkspaceShell>
        <p role="alert">관리자 계정에서만 알림 공간을 관리할 수 있습니다.</p>
        </SettingsWorkspaceShell>;
    return <SpacePolicySettings key={`${boundary.actor.userId}:${boundary.actor.role}:${boundary.recoveryRevision}`} actor={boundary.actor} boundary={boundary}/>;
}
function SpacePolicySettings({ actor, boundary }: {
    actor: AiRequestActor;
    boundary: AiRequestBoundary;
}) {
    const service = useAiAgentRequestService(boundary, actor);
    const [people, setPeople] = useState<Person[]>([{ id: actor.userId, name: boundary.requesterName, role: actor.role }]);
    const [userId, setUserId] = useState(actor.userId);
    const [catalog, setCatalog] = useState<AiSpaceCatalog | null>(null);
    const [policy, setPolicy] = useState<AiSpacePermission | null>(null);
    const [selected, setSelected] = useState<AiSpacePermission['spaceKeys']>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [message, setMessage] = useState('');
    const [revision, setRevision] = useState(0);
    const scope = `policy:${userId}`;
    const attempt = getAiRequestAttempt<{
        userId: string;
        spaceKeys: AiSpacePermission['spaceKeys'];
        version: string;
    }>(actor, scope);
    const busy = useSyncExternalStore(attempt.subscribe, () => attempt.busy, () => false);
    const selectedRef = useRef(selected);
    const scopeRef = useRef(scope);
    useLayoutEffect(() => { selectedRef.current = selected; scopeRef.current = scope; }, [selected, scope]);
    const dirty = Boolean(policy && JSON.stringify(selected) !== JSON.stringify(policy.spaceKeys));
    const draft = useDraftNavigation({ dirty });
    useEffect(() => { const controller = new AbortController(); if (!supabase || !service.active())
        return; void supabase.from('profiles').select('id,name,role').order('name').abortSignal(controller.signal).retry(false).then(({ data, error: failure }) => { if (service.active() && !failure && Array.isArray(data))
        setPeople(data); }); return () => controller.abort(); }, [service]);
    useEffect(() => { const controller = new AbortController(); let active = true; queueMicrotask(() => { if (active) {
        setLoading(true);
        setLoadError('');
        setError('');
        setPolicy(null);
        setSelected([]);
        setMessage('');
    } }); void Promise.all([service.spaces(controller.signal), service.permission(userId, controller.signal)]).then(([spaces, value]) => { if (active && service.active()) {
        setCatalog(spaces);
        setPolicy(value);
        setSelected(readAiRequestDraft<AiSpacePermission['spaceKeys']>(actor, scope) ?? value.spaceKeys);
    } }).catch(failure => { if (active && service.active())
        setLoadError(aiRequestErrorMessage(failure)); }).finally(() => { if (active && service.active())
        setLoading(false); }); return () => { active = false; controller.abort(); }; }, [actor, service, userId, scope, revision]);
    const change = (key: AiSpacePermission['spaceKeys'][number], checked: boolean) => {
        const next = checked
            ? [...selected.filter(value => value !== key), key].sort()
            : selected.filter(value => value !== key);
        setSelected(next);
        writeAiRequestDraft(actor, scope, next);
    };
    const save = async () => {
        if (!policy || busy || (!dirty && !attempt.pending) || !service.active()) return;
        setError('');
        const submittedScope = scope;
        try {
            const outcome = await attempt.submit(
                { userId, spaceKeys: selected, version: policy.revision },
                (payload, key) => service.setPermission(payload.userId, payload.spaceKeys, payload.version, key),
            );
            if (!outcome || !service.active() || scopeRef.current !== submittedScope) return;
            const savedPolicy = BigInt(outcome.receipt.revision) < BigInt(policy.revision)
                ? policy
                : outcome.receipt;
            setPolicy(savedPolicy);
            if (JSON.stringify(selectedRef.current) === JSON.stringify(outcome.submitted.spaceKeys)) {
                setSelected(savedPolicy.spaceKeys);
                deleteAiRequestDraft(actor, scope);
            }
            setMessage('알림 공간 권한을 저장했습니다.');
        } catch (failure) {
            if (service.active() && scopeRef.current === submittedScope) {
                setError(aiRequestErrorMessage(failure));
            }
        }
    };
    return <SettingsWorkspaceShell>
    <SettingsMasterHeader filters={<div className="grid min-w-48 gap-1.5">
        <Label htmlFor="ai-policy-person">직원</Label>
        <NativeSelect id="ai-policy-person" value={userId} disabled={busy} onChange={event => { const next = event.target.value; draft.requestLocalAction(() => setUserId(next)); }}>{people.map(person => <option key={person.id} value={person.id}>{person.name ?? '이름 없음'} · {person.role === 'admin' ? '관리자' : person.role === 'staff' ? '직원' : person.role === 'teacher' ? '선생님' : person.role === 'assistant' ? '조교' : '권한 없음'}</option>)}</NativeSelect>
        </div>} actions={<>
        <Button variant="outline" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>새로고침</Button>
        <Button disabled={loading || busy || !policy || (!dirty && !attempt.pending)} onClick={() => void save()}>{busy ? '저장 중…' : attempt.pending ? '저장 결과 확인' : '변경 저장'}</Button>
        </>}/>
    {loading ? <p role="status">불러오는 중…</p> : null}{loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
    <fieldset className="min-w-0 space-y-3 rounded-[var(--radius-surface)] border border-border/70 bg-background p-4" disabled={loading || !policy}>
    <legend className="sr-only">허용할 완료 알림 공간</legend>{catalog?.items.map(item => <div key={item.key} className="flex items-center gap-2">
        <Checkbox id={`ai-policy-${item.key}`} checked={selected.includes(item.key)} onCheckedChange={value => change(item.key, value === true)}/>
        <Label htmlFor={`ai-policy-${item.key}`}>{item.label}</Label>{!item.configured ? <span className="text-xs text-muted-foreground">미설정</span> : null}</div>)}</fieldset>
    {error || message ? <ActionFeedback message={error || message} error={Boolean(error)} onDismiss={() => { setError(''); setMessage(''); }}/> : null}{draft.confirmation}
  </SettingsWorkspaceShell>;
}
