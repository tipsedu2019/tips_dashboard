'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogContent, DetailDialogContent, ConfirmationDialogContent } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ActionFeedback } from '@/components/ui/action-feedback';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { useDataTablePageSize } from '@/hooks/use-data-table-page-size';
import {
  SettingsWorkspaceShell, SettingsMasterHeader, SettingsTableFrame,
  settingsTableCellClass, settingsTableHeadClass, settingsTableActionCellClass, settingsTableActionHeadClass,
} from '@/features/management/settings-master-layout';
import { useAiAgentRequestActorBoundary, useAiAgentRequestService, type AiRequestBoundary } from './use-ai-agent-requests';
import { sameAiRequestActor, type AiRequestActor } from './ai-agent-request-access';
import { getAiRequestAttempt } from './ai-agent-request-recovery';
import { AiRequestServiceError, type AiSpaceCatalog } from './ai-agent-request-service';
import { AiCredentialError } from './ai-agent-credential-service';
import {
  createAiAgentPersonalCredentialService, type AiPersonalCredential, type AiPersonalCredentialCreate,
} from './ai-agent-personal-credential-service';

type OwnerOption = { id: string; name: string | null };
const dateLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul',
}).format(new Date(value));
const identityLabel = (name: string | null, id: string) => `${name || '이름 없음'} · ${id}`;

export function AiAgentPersonalCredentialWorkspace() {
  const boundary = useAiAgentRequestActorBoundary();
  if (!boundary.actor || !boundary.access.canViewAll) {
    return <SettingsWorkspaceShell><p role="alert">관리자 계정에서만 개인 요청 키를 관리할 수 있습니다.</p></SettingsWorkspaceShell>;
  }
  return <PersonalCredentialWorkspace
    key={`${boundary.actor.userId}:${boundary.actor.role}:${boundary.recoveryRevision}`}
    actor={boundary.actor} boundary={boundary}
  />;
}

function PersonalCredentialWorkspace({ actor, boundary }: { actor: AiRequestActor; boundary: AiRequestBoundary }) {
  const { getCurrentActor, getSession } = boundary;
  const service = useMemo(() => createAiAgentPersonalCredentialService({
    actor, getCurrentActor,
    rpc: async (name, args) => {
      const session = await getSession();
      if (!session || session.user.id !== actor.userId || !sameAiRequestActor(actor, getCurrentActor())) {
        throw new AiCredentialError(true, 'actor_changed');
      }
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url) throw new AiCredentialError(false);
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(args), signal: AbortSignal.timeout(10_000), cache: 'no-store',
      });
      const data = await response.json();
      return response.ok ? { data, error: null } : { data: null, error: data };
    },
  }), [actor, getCurrentActor, getSession]);
  const requestService = useAiAgentRequestService(boundary, actor);
  const [rows, setRows] = useState<AiPersonalCredential[]>([]);
  const [total, setTotal] = useState(0), [support, setSupport] = useState(false);
  const [catalog, setCatalog] = useState<AiSpaceCatalog | null>(null);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const [open, setOpen] = useState(false), [secret, setSecret] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<AiPersonalCredential | null>(null);
  const [label, setLabel] = useState('개인 요청'), [ownerId, setOwnerId] = useState('');
  const [preset, setPreset] = useState('read'), [days, setDays] = useState('1');
  const [chat, setChat] = useState(false), [spaces, setSpaces] = useState<string[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]), [ownerTotal, setOwnerTotal] = useState(0);
  const [ownerPage, setOwnerPage] = useState(1), [ownerRevision, setOwnerRevision] = useState(0);
  const [ownersLoading, setOwnersLoading] = useState(true), [ownersError, setOwnersError] = useState('');
  const { pageSize, ready, setPreference } = useDataTablePageSize('settings:personal-credential');
  const opener = useRef<HTMLButtonElement>(null), generation = useRef(0);
  const createAttempt = getAiRequestAttempt<AiPersonalCredentialCreate>(actor, 'personal-credential:create');
  const revokeAttempt = getAiRequestAttempt<{ id: string }>(actor, `personal-credential:revoke:${revokeTarget?.id ?? ''}`);
  const creating = useSyncExternalStore(createAttempt.subscribe, () => createAttempt.busy, () => false);
  const revoking = useSyncExternalStore(revokeAttempt.subscribe, () => revokeAttempt.busy, () => false);
  const busy = creating || revoking;
  const pendingPayload = createAttempt.pending?.payload;
  const formOwnerId = pendingPayload?.ownerProfileId ?? ownerId;
  const formChat = pendingPayload ? pendingPayload.scopes.includes('chat:send') : chat;
  const formSpaces = pendingPayload?.grant.spaceKeys ?? spaces;
  const fieldsLocked = creating || Boolean(pendingPayload);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setLoadError(''); } });
    void Promise.all([service.list(page, pageSize), requestService.spaces()]).then(([list, spaceCatalog]) => {
      if (!active || !service.active()) return;
      if (!list.items.length && page > Math.max(1, Math.ceil(list.total / pageSize))) {
        setPage(Math.max(1, Math.ceil(list.total / pageSize)));
        return;
      }
      setRows(list.items); setTotal(list.total); setSupport(list.supportEnabled); setCatalog(spaceCatalog); setObservedAt(Date.now());
    }).catch(() => {
      if (active && service.active()) setLoadError('개인 요청 키 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
    }).finally(() => { if (active && service.active()) setLoading(false); });
    return () => { active = false; };
  }, [service, requestService, page, pageSize, revision, ready]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => { if (active) { setOwnersLoading(true); setOwnersError(''); } });
    void service.owners(ownerPage, 20).then(result => {
      if (!active || !service.active()) return;
      setOwners(current => ownerPage === 1 ? result.items : [...new Map(
        [...current, ...result.items].map(owner => [owner.id, owner]),
      ).values()]);
      setOwnerTotal(result.total);
    }).catch(() => {
      if (active && service.active()) setOwnersError('요청 소유자 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
    }).finally(() => { if (active && service.active()) setOwnersLoading(false); });
    return () => { active = false; };
  }, [service, open, ownerPage, ownerRevision]);
  useEffect(() => () => { generation.current++; }, []);

  const close = () => { generation.current++; setOpen(false); setSecret(''); setError(''); };
  const beginCreate = () => {
    setError(''); setOwnerPage(1); setOwnersLoading(true); setOwnersError(''); setOpen(true);
  };
  async function send<T>(operation: () => Promise<T>) {
    try { return await operation(); }
    catch (failure) {
      if (failure instanceof AiCredentialError && failure.definite) throw new AiRequestServiceError('credential_denied', true);
      throw failure;
    }
  }
  const selectable = (key: string) => catalog?.items.some(space => space.key === key && space.configured && space.selectable);
  const validOwner = owners.some(owner => owner.id === ownerId);
  const validDraft = Boolean(label.trim() && validOwner && !ownersLoading && !ownersError
    && (!chat || spaces.length > 0 && spaces.every(selectable)));

  async function issue() {
    if (createAttempt.busy || revokeAttempt.busy || !service.active() || !createAttempt.pending && (!support || !validDraft)) return;
    setError('');
    const current = ++generation.current;
    try {
      const payload: AiPersonalCredentialCreate = createAttempt.pending?.payload ?? {
        label: label.trim(), ownerProfileId: ownerId,
        scopes: [
          ...(preset === 'worker'
            ? ['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update'] as const
            : ['ai-agent:requests:read'] as const),
          ...(chat ? ['chat:outbox:read', 'chat:send'] as const : []),
        ],
        grant: {
          queues: ['employee_requests'],
          actions: preset === 'worker' ? ['read', 'claim', 'renew', 'progress', 'question', 'done'] : ['read'],
          ...(chat ? {
            spaceKeys: [...spaces] as NonNullable<AiPersonalCredentialCreate['grant']['spaceKeys']>,
            purposes: ['ai_completion'] as NonNullable<AiPersonalCredentialCreate['grant']['purposes']>,
          } : {}),
        },
        expiresAt: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
      };
      const outcome = await createAttempt.submit(payload, (submitted, key) => send(() => service.create(submitted, key)));
      if (!outcome || !service.active() || current !== generation.current) return;
      setRevision(value => value + 1); setOpen(false); setSecret(outcome.receipt.token ?? '');
      setMessage(outcome.receipt.token ? '개인 요청 키를 발급했습니다.'
        : '발급 기록을 확인했습니다. 원문 키는 다시 표시할 수 없습니다. 필요한 경우 이 키를 폐기한 뒤 새로 발급하세요.');
    } catch {
      if (service.active() && current === generation.current) setError(createAttempt.pending
        ? '발급 결과를 확인하지 못했습니다. 같은 발급의 결과를 다시 확인하세요.'
        : '발급하지 못했습니다. 소유자 권한과 선택 항목을 확인하세요.');
    }
  }
  async function revoke() {
    if (!revokeTarget || createAttempt.busy || revokeAttempt.busy || !service.active()) return;
    setError('');
    const current = ++generation.current;
    try {
      const outcome = await revokeAttempt.submit({ id: revokeTarget.id }, (submitted, key) => send(() => service.revoke(submitted.id, key)));
      if (!outcome || !service.active() || current !== generation.current) return;
      setRevokeTarget(null); setRevision(value => value + 1); setMessage('개인 요청 키를 폐기했습니다.');
    } catch {
      if (service.active() && current === generation.current) setError('폐기 결과를 확인하지 못했습니다. 같은 작업을 다시 확인하세요.');
    }
  }
  const canIssue = !busy && (Boolean(createAttempt.pending) || !loading && !loadError && support);

  return <SettingsWorkspaceShell>
    <SettingsMasterHeader actions={<>
      <Button variant="outline" aria-label="개인 요청 키 새로고침" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" />새로고침</Button>
      <Button ref={opener} disabled={!canIssue} onClick={beginCreate}><Plus aria-hidden="true" />{createAttempt.pending ? '발급 결과 확인' : '개인 요청 키 발급'}</Button>
    </>} />
    {loadError || message ? <ActionFeedback error={Boolean(loadError)} message={loadError || message} onDismiss={() => setMessage('')} /> : null}
    {!loading && !loadError && !support ? <p className="text-sm text-muted-foreground">개인 요청 키 발급 준비 중</p> : null}
    <SettingsTableFrame><Table className="min-w-[1060px]"><TableHeader><TableRow>
      {['이름', '요청 소유자', '발급 관리자', '권한', '알림 공간', '만료', '상태', '작업'].map(text => <TableHead key={text} className={text === '작업' ? settingsTableActionHeadClass : settingsTableHeadClass}>{text}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {rows.map(row => {
        const usable = !row.revokedAt && Date.parse(row.expiresAt) > observedAt;
        return <TableRow key={row.id}>
          <TableCell className={settingsTableCellClass}>{row.label}</TableCell>
          <TableCell className={settingsTableCellClass}><span>{row.ownerName || '이름 없음'}</span><span className="block break-all text-xs text-muted-foreground">{row.ownerProfileId}</span></TableCell>
          <TableCell className={settingsTableCellClass}><span>{row.issuerName || '이름 없음'}</span><span className="block break-all text-xs text-muted-foreground">{row.issuerProfileId}</span></TableCell>
          <TableCell className={settingsTableCellClass}>{row.scopes.includes('ai-agent:requests:claim') ? '본인 요청 처리' : '본인 요청 읽기'}</TableCell>
          <TableCell className={settingsTableCellClass}>{row.grant.spaceKeys?.map(key => catalog?.items.find(space => space.key === key)?.label ?? key).join(' · ') || '없음'}</TableCell>
          <TableCell className={settingsTableCellClass}>{dateLabel(row.expiresAt)}</TableCell>
          <TableCell className={settingsTableCellClass}>{row.revokedAt ? '폐기' : usable ? '사용 가능' : '만료'}</TableCell>
          <TableCell className={settingsTableActionCellClass}><Button variant="outline" size="sm" disabled={!usable || busy} aria-label={`${row.label} 개인 요청 키 폐기`} onClick={() => { setError(''); setRevokeTarget(row); }}>폐기</Button></TableCell>
        </TableRow>;
      })}
      {!rows.length ? <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{loading ? '불러오는 중…' : loadError ? '목록을 확인하지 못했습니다.' : '발급한 개인 요청 키가 없습니다.'}</TableCell></TableRow> : null}
    </TableBody></Table></SettingsTableFrame>
    <DataTablePagination page={page} totalCount={loadError ? null : total} pageSize={pageSize} loading={loading} onPageChange={setPage} onPageSizeChange={value => { setPreference(value); setPage(1); }} ariaLabel="개인 요청 키 페이지" />
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <FormDialogContent title="개인 요청 키 발급" description="선택한 요청 소유자의 본인 요청만 허용합니다." returnFocusRef={opener}
        onSubmit={event => { event.preventDefault(); void issue(); }} onCancel={close} cancelLabel="개인 요청 키 발급 취소"
        submitLabel={createAttempt.pending ? '발급 결과 확인' : '발급'} busy={creating}
        submitDisabled={!createAttempt.pending && (!support || !validDraft)} error={error}
        hint={pendingPayload ? '처음 제출한 소유자와 권한으로 발급 결과를 확인합니다.' : ''}>
        <div><Label htmlFor="ai-personal-credential-owner">요청 소유자 <span aria-hidden="true">*</span><span className="sr-only">필수 입력</span></Label>
          <NativeSelect id="ai-personal-credential-owner" name="ownerProfileId" value={formOwnerId} disabled={fieldsLocked || ownersLoading} required={!pendingPayload} aria-required={!pendingPayload} onChange={event => setOwnerId(event.target.value)}>
            <option value="">교사 선택</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{identityLabel(owner.name, owner.id)}</option>)}
            {pendingPayload && !owners.some(owner => owner.id === formOwnerId) ? <option value={formOwnerId}>{identityLabel(null, formOwnerId)}</option> : null}
          </NativeSelect>
          {ownersError ? <div><p role="alert" className="text-sm text-destructive">{ownersError}</p><Button type="button" variant="outline" size="sm" disabled={ownersLoading} onClick={() => setOwnerRevision(value => value + 1)}>소유자 목록 다시 시도</Button></div>
            : ownersLoading ? <p role="status" className="text-sm text-muted-foreground">요청 소유자를 불러오는 중입니다.</p>
            : !owners.length ? <p className="text-sm text-muted-foreground">선택할 수 있는 교사가 없습니다.</p> : null}
          {owners.length < ownerTotal ? <Button type="button" variant="outline" size="sm" disabled={creating || ownersLoading || Boolean(ownersError)} onClick={() => setOwnerPage(value => value + 1)}>더 불러오기</Button> : null}
        </div>
        <div><Label htmlFor="ai-personal-credential-label">이름</Label><Input id="ai-personal-credential-label" name="label" autoComplete="off" value={pendingPayload?.label ?? label} maxLength={80} disabled={fieldsLocked} onChange={event => setLabel(event.target.value)} /></div>
        <div><Label htmlFor="ai-personal-credential-preset">요청 권한</Label><NativeSelect id="ai-personal-credential-preset" value={pendingPayload ? pendingPayload.scopes.includes('ai-agent:requests:claim') ? 'worker' : 'read' : preset} disabled={fieldsLocked} onChange={event => setPreset(event.target.value)}><option value="read">본인 요청 읽기</option><option value="worker">본인 요청 처리</option></NativeSelect></div>
        <div><Label htmlFor="ai-personal-credential-days">{pendingPayload ? '만료' : '유효 기간'}</Label>{pendingPayload
          ? <Input id="ai-personal-credential-days" value={pendingPayload.expiresAt ? dateLabel(pendingPayload.expiresAt) : '기본 만료'} readOnly />
          : <NativeSelect id="ai-personal-credential-days" value={days} disabled={fieldsLocked} onChange={event => setDays(event.target.value)}>{[1, 7, 30].map(value => <option key={value} value={value}>{value}일</option>)}</NativeSelect>}</div>
        <Label htmlFor="ai-personal-credential-chat" className="flex items-center gap-2"><Checkbox id="ai-personal-credential-chat" checked={formChat} disabled={fieldsLocked} onCheckedChange={value => setChat(value === true)} />본인 요청 완료 알림</Label>
        {formChat ? <fieldset><legend className="text-sm font-medium">알림 공간</legend><div className="grid grid-cols-2 gap-3 pt-2">
          {catalog?.items.map(space => <Label htmlFor={`ai-personal-credential-space_${space.key}`} key={space.key} className="flex items-center gap-2">
            <Checkbox id={`ai-personal-credential-space_${space.key}`} checked={formSpaces.includes(space.key)} disabled={fieldsLocked || !space.configured || !space.selectable}
              onCheckedChange={value => setSpaces(current => value === true ? [...current.filter(key => key !== space.key), space.key] : current.filter(key => key !== space.key))} />
            {space.label}{!space.configured ? ' · 미설정' : !space.selectable ? ' · 선택 불가' : ''}
          </Label>)}
        </div></fieldset> : null}
      </FormDialogContent>
    </Dialog>
    <Dialog open={Boolean(secret)} onOpenChange={value => { if (!value) { generation.current++; setSecret(''); } }}>
      <DetailDialogContent title="개인 요청 키" description="원문 키는 지금 한 번만 표시됩니다." returnFocusRef={opener} onClose={() => { generation.current++; setSecret(''); }}>
        <div className="space-y-4"><Input aria-label="발급된 개인 요청 키" value={secret} readOnly /><Button variant="outline" onClick={() => {
          const current = generation.current;
          void navigator.clipboard.writeText(secret).catch(() => { if (service.active() && current === generation.current) setMessage('복사하지 못했습니다. 키를 직접 선택해 복사하세요.'); });
        }}><Copy aria-hidden="true" />키 복사</Button></div>
      </DetailDialogContent>
    </Dialog>
    <Dialog open={Boolean(revokeTarget)} onOpenChange={value => { if (!value && !revoking) { generation.current++; setRevokeTarget(null); } }}>
      <ConfirmationDialogContent title="개인 요청 키 폐기" description={`${revokeTarget?.label ?? ''}의 접근을 중단합니다.`}
        confirmLabel={revokeAttempt.pending ? '결과 확인' : '폐기'} onConfirm={() => void revoke()}
        onCancel={() => { if (!revoking) { generation.current++; setRevokeTarget(null); } }} busy={revoking} error={error} />
    </Dialog>
  </SettingsWorkspaceShell>;
}
