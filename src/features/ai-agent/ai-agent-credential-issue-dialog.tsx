'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, RefreshCw, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogContent, DetailDialogContent, ConfirmationDialogContent } from '@/components/ui/form-dialog';
import { ActionFeedback } from '@/components/ui/action-feedback';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { SettingsWorkspaceShell, SettingsMasterHeader, SettingsTableFrame, settingsTableCellClass, settingsTableHeadClass, settingsTableActionCellClass, settingsTableActionHeadClass } from '@/features/management/settings-master-layout';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { useDataTablePageSize } from '@/hooks/use-data-table-page-size';
import { useAiAgentRequestActorBoundary, useAiAgentRequestService, type AiRequestBoundary } from './use-ai-agent-requests';
import { type AiRequestActor, sameAiRequestActor } from './ai-agent-request-access';
import { AiRequestServiceError, type AiSpaceCatalog } from './ai-agent-request-service';
import { getAiRequestAttempt } from './ai-agent-request-recovery';
import { createAiAgentCredentialService, AiCredentialError, type AiCredential, type AiCredentialCreate } from './ai-agent-credential-service';
const date = (value: string | null) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value)) : '—';
export function AiAgentCredentialWorkspace() {
    const boundary = useAiAgentRequestActorBoundary();
    if (!boundary.actor || !boundary.access.canViewAll)
        return <SettingsWorkspaceShell><p role="alert">관리자 계정에서만 AI 요청 키를 관리할 수 있습니다.</p></SettingsWorkspaceShell>;
    return <CredentialWorkspace key={`${boundary.actor.userId}:${boundary.actor.role}:${boundary.recoveryRevision}`} actor={boundary.actor} boundary={boundary}/>;
}
function CredentialWorkspace({ actor, boundary }: {
    actor: AiRequestActor;
    boundary: AiRequestBoundary;
}) {
    const getCurrentActor = boundary.getCurrentActor, getSession = boundary.getSession;
    const service = useMemo(() => createAiAgentCredentialService({ actor, getCurrentActor, rpc: async (name, args) => {
            const session = await getSession();
            if (!session || session.user.id !== actor.userId || !sameAiRequestActor(actor, getCurrentActor()))
                throw new AiCredentialError(true, 'actor_changed');
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
            if (!url)
                throw new AiCredentialError(false);
            const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000), cache: 'no-store' });
            const data = await response.json();
            return response.ok ? { data, error: null } : { data: null, error: data };
        } }), [actor, getCurrentActor, getSession]);
    const requestService = useAiAgentRequestService(boundary, actor);
    const [rows, setRows] = useState<AiCredential[]>([]), [total, setTotal] = useState(0), [support, setSupport] = useState(false), [catalog, setCatalog] = useState<AiSpaceCatalog | null>(null);
    const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [message, setMessage] = useState('');
    const { pageSize, ready, setPreference } = useDataTablePageSize('settings:ai-agent-credentials');
    const [open, setOpen] = useState(false), [secret, setSecret] = useState(''), [error, setError] = useState(''), [revokeTarget, setRevokeTarget] = useState<AiCredential | null>(null);
    const [label, setLabel] = useState('AI 에이전트'), [preset, setPreset] = useState('read'), [days, setDays] = useState('1'), [chat, setChat] = useState(false), [spaces, setSpaces] = useState<string[]>([]), [purposes, setPurposes] = useState<string[]>([]), [source, setSource] = useState('');
    const chatOnly = preset === 'chat_reply';
    const effectivePurposes = chatOnly ? ['bridge_reply'] : purposes;
    const opener = useRef<HTMLButtonElement>(null), generation = useRef(0);
    const createAttempt = getAiRequestAttempt<AiCredentialCreate>(actor, 'credential:create');
    const revokeAttempt = getAiRequestAttempt<{
        id: string;
    }>(actor, `credential:revoke:${revokeTarget?.id ?? ''}`);
    const pendingPayload = createAttempt.pending?.payload;
    const creating = useSyncExternalStore(createAttempt.subscribe, () => createAttempt.busy, () => false), revoking = useSyncExternalStore(revokeAttempt.subscribe, () => revokeAttempt.busy, () => false);
    useEffect(() => {
        if (!ready)
            return;
        let active = true;
        queueMicrotask(() => {
            if (active) {
                setLoading(true);
                setLoadError('');
            }
        });
        void Promise.all([service.list(page, pageSize), requestService.spaces()]).then(([list, spaces]) => {
            if (active && service.active()) {
                setRows(list.items);
                setTotal(list.total);
                setSupport(list.supportEnabled);
                setCatalog(spaces);
            }
        }).catch(() => {
            if (active && service.active())
                setLoadError('AI 요청 키 목록을 불러오지 못했습니다.');
        }).finally(() => {
            if (active && service.active())
                setLoading(false);
        });
        return () => { active = false; };
    }, [service, requestService, page, pageSize, revision, ready]);
    useEffect(() => () => { generation.current++; }, []);
    const close = () => { generation.current++; setOpen(false); setSecret(''); setError(''); };
    async function send<T>(operation: () => Promise<T>) {
        try {
            return await operation();
        }
        catch (failure) {
            if (failure instanceof AiCredentialError && failure.definite)
                throw new AiRequestServiceError('credential_denied', true);
            throw failure;
        }
    }
    const issue = async () => {
        if (creating || (!support && !createAttempt.pending) || !service.active())
            return;
        setError('');
        const current = ++generation.current;
        try {
            const payload: AiCredentialCreate = createAttempt.pending?.payload ?? { label, scopes: chatOnly ? [] : preset === 'worker' ? ['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update'] : ['ai-agent:requests:read'], grant: chatOnly ? {} : { queues: ['employee_requests'], actions: preset === 'worker' ? ['read', 'claim', 'renew', 'progress', 'question', 'done'] : ['read'] }, expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString() };
            if (!createAttempt.pending && (chat || chatOnly)) {
                if (!spaces.length || !effectivePurposes.length || spaces.some(key => !catalog?.items.some(s => s.key === key && s.configured)) || (effectivePurposes.includes('bridge_reply') && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(source)))
                    throw new AiCredentialError(true);
                payload.scopes.push('chat:outbox:read', 'chat:send');
                payload.grant.spaceKeys = spaces as NonNullable<AiCredentialCreate['grant']['spaceKeys']>;
                payload.grant.purposes = effectivePurposes as NonNullable<AiCredentialCreate['grant']['purposes']>;
                if (effectivePurposes.includes('bridge_reply'))
                    payload.grant.bridgeSourceId = source;
            }
            const outcome = await createAttempt.submit(payload, (submitted, key) => send(() => service.create(submitted, key)));
            if (!outcome || !service.active() || current !== generation.current)
                return;
            setRevision(v => v + 1);
            setOpen(false);
            setSecret(outcome.receipt.token ?? '');
            setMessage(outcome.receipt.token ? 'AI 요청 키를 발급했습니다.' : '발급 기록을 확인했습니다. 원문 키는 다시 표시할 수 없습니다. 필요한 경우 이 키를 폐기한 뒤 새로 발급하세요.');
        }
        catch {
            if (service.active() && current === generation.current)
                setError(createAttempt.pending ? '발급 결과를 확인하지 못했습니다. 같은 발급의 결과를 다시 확인하세요.' : '발급하지 못했습니다. 권한과 선택 항목을 확인하세요.');
        }
    };
    const revoke = async () => {
        if (!revokeTarget || revoking || !service.active())
            return;
        setError('');
        try {
            await revokeAttempt.submit({ id: revokeTarget.id }, (submitted, key) => send(() => service.revoke(submitted.id, key)));
            if (service.active()) {
                setRevokeTarget(null);
                setRevision(v => v + 1);
                setMessage('AI 요청 키를 폐기했습니다.');
            }
        }
        catch {
            if (service.active())
                setError('폐기 결과를 확인하지 못했습니다. 같은 작업을 다시 확인하세요.');
        }
    };
    const toggle = (items: string[], value: string, checked: boolean) => checked ? [...items.filter(x => x !== value), value] : items.filter(x => x !== value);
    return <SettingsWorkspaceShell>
  <SettingsMasterHeader actions={<><Button variant="outline" aria-label="AI 요청 키 새로고침" onClick={() => setRevision(v => v + 1)}><RefreshCw aria-hidden="true"/>새로고침</Button><Button ref={opener} disabled={loading || Boolean(loadError) || (!support && !createAttempt.pending)} onClick={() => { setError(''); setOpen(true); }}><Plus aria-hidden="true"/>{createAttempt.pending ? '발급 결과 확인' : 'AI 요청 키 발급'}</Button></>}/>
  {loadError || message ? <ActionFeedback error={Boolean(loadError)} message={loadError || message} onDismiss={() => { setLoadError(''); setMessage(''); }}/> : null}
  {!loading && !loadError && !support ? <p className="text-sm text-muted-foreground">AI 요청 키 발급 준비 중</p> : null}
  <SettingsTableFrame><Table className="min-w-[860px]"><TableHeader><TableRow>{['이름', '권한', '범위', '만료', '상태', ''].map(text => <TableHead key={text} className={text === '' ? settingsTableActionHeadClass : settingsTableHeadClass}>{text}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}><TableCell className={settingsTableCellClass}>{row.label}</TableCell><TableCell className={settingsTableCellClass}>{row.scopes.includes('ai-agent:requests:claim') ? '요청 처리' : row.scopes.includes('ai-agent:requests:read') ? '읽기' : 'Chat 답글'}{row.scopes.includes('ai-agent:requests:read') && row.scopes.includes('chat:send') ? ' · Chat' : ''}</TableCell><TableCell className={settingsTableCellClass}>{row.grant.queues?.length ? '직원 전체 요청' : ''}{row.grant.spaceKeys?.length ? `${row.grant.queues?.length ? ' · ' : ''}Chat ${row.grant.spaceKeys.length}개 공간` : ''}</TableCell><TableCell className={settingsTableCellClass}>{date(row.expiresAt)}</TableCell><TableCell className={settingsTableCellClass}>{row.revokedAt ? '폐기' : new Date(row.expiresAt) <= new Date() ? '만료' : '사용 가능'}</TableCell><TableCell className={settingsTableActionCellClass}><Button variant="outline" size="sm" disabled={Boolean(row.revokedAt)} onClick={() => { setError(''); setRevokeTarget(row); }}>폐기</Button></TableCell></TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">{loading ? '불러오는 중…' : loadError ? '목록을 확인하지 못했습니다.' : '발급한 AI 요청 키가 없습니다.'}</TableCell></TableRow> : null}</TableBody></Table></SettingsTableFrame><DataTablePagination page={page} totalCount={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={value => { setPreference(value); setPage(1); }}/>
  <Dialog open={open} onOpenChange={value => {
            if (!value)
                close();
        }}><FormDialogContent title="AI 요청 키 발급" description={pendingPayload ? "이전에 요청한 아래 권한의 발급 결과를 확인합니다." : chatOnly ? "선택한 Chat 공간의 기존 대화에 답글을 보낼 연결 키입니다." : "직원 전체 요청에 접근할 연결 키입니다. 개별 요청 소유자 범위로 제한되지 않습니다."} returnFocusRef={opener} onSubmit={event => { event.preventDefault(); void issue(); }} onCancel={close} cancelLabel="취소" submitLabel={createAttempt.pending ? '발급 결과 확인' : '발급'} busy={creating} submitDisabled={(!support && !createAttempt.pending) || (!pendingPayload && !label.trim())} error={error}>
   {pendingPayload ? <dl className="space-y-3 text-sm" aria-label="확인 중인 발급 권한">
    <div><dt className="text-muted-foreground">이름</dt><dd>{pendingPayload.label}</dd></div>
    <div><dt className="text-muted-foreground">권한</dt><dd>{pendingPayload.scopes.includes('ai-agent:requests:claim') ? '요청 처리 · 직원 전체 요청' : pendingPayload.scopes.includes('ai-agent:requests:read') ? '읽기 · 직원 전체 요청' : 'Chat 전용'}</dd></div>
    {pendingPayload.grant.spaceKeys?.length ? <div><dt className="text-muted-foreground">전송 공간</dt><dd>{pendingPayload.grant.spaceKeys.map(key => catalog?.items.find(s => s.key === key)?.label ?? key).join(', ')}</dd></div> : null}
    {pendingPayload.grant.purposes?.length ? <div><dt className="text-muted-foreground">전송 목적</dt><dd>{pendingPayload.grant.purposes.map(purpose => purpose === 'bridge_reply' ? '기존 대화 답글' : '완료 알림').join(', ')}</dd></div> : null}
    {pendingPayload.grant.bridgeSourceId ? <div><dt className="text-muted-foreground">고정 Bridge 소스 ID</dt><dd className="break-all">{pendingPayload.grant.bridgeSourceId}</dd></div> : null}
    <div><dt className="text-muted-foreground">만료</dt><dd>{date(pendingPayload.expiresAt ?? null)}</dd></div>
   </dl> : <div className="space-y-4"><div><Label htmlFor="ai-credential-label">이름</Label><Input id="ai-credential-label" value={label} maxLength={80} disabled={creating} onChange={e => setLabel(e.target.value)}/></div><div><Label htmlFor="ai-credential-preset">권한</Label><NativeSelect id="ai-credential-preset" value={preset} disabled={creating} onChange={e => setPreset(e.target.value)}><option value="read">읽기 · 직원 전체 요청</option><option value="worker">요청 처리 · 직원 전체 요청</option><option value="chat_reply">Chat 답글 전용</option></NativeSelect>{preset === 'worker' ? <p className="text-sm text-muted-foreground">읽기, claim, renew, 진행 기록, 질문, 완료</p> : null}</div><div><Label htmlFor="ai-credential-days">유효 기간</Label><NativeSelect id="ai-credential-days" value={days} disabled={creating} onChange={e => setDays(e.target.value)}>{[1, 7, 30].map(n => <option key={n} value={n}>{n}일</option>)}</NativeSelect></div>
   <Label className="flex items-center gap-2"><Checkbox checked={chat || chatOnly} disabled={creating || chatOnly} onCheckedChange={v => setChat(v === true)}/>Chat 전송 권한</Label>{chat || chatOnly ? <><fieldset><legend className="text-sm font-medium">전송 공간</legend><div className="grid grid-cols-2 gap-3 pt-2">{catalog?.items.map(space => <Label key={space.key} className="flex items-center gap-2"><Checkbox checked={spaces.includes(space.key)} disabled={creating || !space.configured} onCheckedChange={v => setSpaces(current => toggle(current, space.key, v === true))}/>{space.label}{!space.configured ? ' · 미설정' : ''}</Label>)}</div></fieldset><fieldset><legend className="text-sm font-medium">전송 목적</legend><div className="flex flex-wrap gap-3 pt-2">{(chatOnly ? [['bridge_reply', '기존 대화 답글']] : [['ai_completion', '완료 알림'], ['bridge_reply', '기존 대화 답글']]).map(([value, text]) => <Label key={value} className="flex items-center gap-2"><Checkbox checked={effectivePurposes.includes(value)} disabled={creating || chatOnly} onCheckedChange={v => setPurposes(current => toggle(current, value, v === true))}/>{text}</Label>)}</div></fieldset>{effectivePurposes.includes('bridge_reply') ? <div><Label htmlFor="ai-credential-source">고정 Bridge 소스 ID</Label><Input id="ai-credential-source" value={source} disabled={creating} onChange={e => setSource(e.target.value)}/></div> : null}</> : null}</div>}
  </FormDialogContent></Dialog>
  <Dialog open={Boolean(secret)} onOpenChange={value => {
            if (!value)
                setSecret('');
        }}><DetailDialogContent title="AI 요청 키" description="원문 키는 지금 한 번만 표시됩니다." returnFocusRef={opener} onClose={() => setSecret('')}><div className="space-y-4"><Input aria-label="발급된 AI 요청 키" value={secret} readOnly/><Button variant="outline" onClick={() => void navigator.clipboard.writeText(secret).catch(() => setMessage('복사하지 못했습니다. 키를 직접 선택해 복사하세요.'))}><Copy aria-hidden="true"/>키 복사</Button></div></DetailDialogContent></Dialog>
  <Dialog open={Boolean(revokeTarget)} onOpenChange={value => {
            if (!value && !revoking)
                setRevokeTarget(null);
        }}><ConfirmationDialogContent title="AI 요청 키 폐기" description={`${revokeTarget?.label ?? ''}의 접근을 중단합니다.`} confirmLabel={revokeAttempt.pending ? '결과 확인' : '폐기'} onConfirm={() => void revoke()} onCancel={() => setRevokeTarget(null)} busy={revoking} error={error}/></Dialog>
 </SettingsWorkspaceShell>;
}
