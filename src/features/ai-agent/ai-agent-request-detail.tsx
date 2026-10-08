'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmationDialogContent, FormDialogContent } from '@/components/ui/form-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ActionFeedback } from '@/components/ui/action-feedback';
import { useDraftNavigation } from '@/hooks/use-draft-navigation';
import { type AiRequestActor } from './ai-agent-request-access';
import { type AiMessageInput, type AiRequest } from './ai-agent-request-contract';
import { type AiActivity, type AiAgentRequestService, aiRequestErrorMessage } from './ai-agent-request-service';
import { readAiRequestDraft, writeAiRequestDraft, deleteAiRequestDraft, getAiRequestAttempt } from './ai-agent-request-recovery';
import { useAiAgentRequestActorBoundary, useAiAgentRequestService, type AiRequestBoundary } from './use-ai-agent-requests';
import { AI_REQUEST_STATUS_LABELS, aiRequestDate } from './ai-agent-request-workspace';
import { AiAgentRequestActivity } from './ai-agent-request-activity';
export function AiAgentRequestDetail({ id }: {
    id: string;
}) {
    const boundary = useAiAgentRequestActorBoundary();
    if (boundary.loading)
        return <p role="status">권한 확인 중…</p>;
    if (!boundary.actor)
        return <p role="alert">AI 요청에 접근할 권한이 없습니다.</p>;
    return <RequestDetail key={`${boundary.actor.userId}:${boundary.actor.role}:${boundary.recoveryRevision}:${id}`} id={id} actor={boundary.actor} boundary={boundary}/>;
}
function RequestDetail({ id, actor, boundary }: {
    id: string;
    actor: AiRequestActor;
    boundary: AiRequestBoundary;
}) {
    const service = useAiAgentRequestService(boundary, actor);
    const [activity, setActivity] = useState<AiActivity | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [revision, setRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [resumeOpen, setResumeOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const reasonRef = useRef(reason);
    useEffect(() => { reasonRef.current = reason; }, [reason]);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const resumeRef = useRef<HTMLButtonElement>(null);
    const cancelAttempt = getAiRequestAttempt<{
        version: string;
    }>(actor, `request:${id}:cancel`);
    const resumeAttempt = getAiRequestAttempt<{
        version: string;
        reason: string;
    }>(actor, `request:${id}:resume`);
    const draft = useDraftNavigation({ dirty: dirty || Boolean(reason) });
    const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
    useEffect(() => { const controller = new AbortController(); let active = true; queueMicrotask(() => { if (active) {
        setLoading(true);
        setLoadError('');
    } }); void Promise.all([service.activity(id, controller.signal), service.actions(id, controller.signal)]).then(([value, actions]) => { if (active && service.active())
        setActivity({ ...value, actions }); }).catch(failure => { if (active && service.active())
        setLoadError(aiRequestErrorMessage(failure)); }).finally(() => { if (active && service.active())
        setLoading(false); }); return () => { active = false; controller.abort(); }; }, [id, service, revision]);
    const cancel = async () => { if (!activity || busy || !service.active())
        return; setBusy(true); setError(''); try {
        const outcome = await cancelAttempt.submit({ version: activity.request.version }, (payload, key) => service.cancel(id, payload.version, key));
        if (outcome && service.active()) {
            setActivity(value => value ? { ...value, request: outcome.receipt } : value);
            setCancelOpen(false);
            setMessage('요청을 취소했습니다.');
            setRevision(value => value + 1);
        }
    }
    catch (failure) {
        if (service.active())
            setError(aiRequestErrorMessage(failure));
    }
    finally {
        if (service.active())
            setBusy(false);
    } };
    const resume = async (event: React.FormEvent) => { event.preventDefault(); if (!activity || busy || !confirmed || !reason.trim() || !service.active())
        return; setBusy(true); setError(''); try {
        const outcome = await resumeAttempt.submit({ version: activity.request.version, reason }, (payload, key) => service.resume(id, payload.reason, payload.version, key));
        if (outcome && service.active()) {
            setActivity(value => value ? { ...value, request: outcome.receipt } : value);
            if (reasonRef.current === outcome.submitted.reason) {
                setReason('');
                setResumeOpen(false);
            }
            setConfirmed(false);
            setMessage('요청을 재개했습니다.');
            setRevision(value => value + 1);
        }
    }
    catch (failure) {
        if (service.active())
            setError(aiRequestErrorMessage(failure));
    }
    finally {
        if (service.active())
            setBusy(false);
    } };
    const request = activity?.request;
    const terminal = request?.status === 'done' || request?.status === 'cancelled';
    const resumable = boundary.access.canViewAll && request?.status === 'processing' && (!activity?.claim || activity.claim.leaseState === 'expired') && !activity?.actions.some(action => ['prepared', 'started', 'unknown'].includes(action.state));
    return <div className="mx-auto w-full min-w-0 max-w-[1560px] space-y-4 px-4 sm:px-5 lg:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
    <Link href="/admin/ai-agent" prefetch={false} className="text-sm hover:underline">AI 요청 목록</Link>
    <div className="flex gap-2">
    <Button variant="outline" onClick={() => setRevision(value => value + 1)} disabled={loading}>새로고침</Button>{request && !terminal ? <Button ref={cancelRef} variant="outline" onClick={() => { setError(''); draft.requestLocalAction(() => setCancelOpen(true)); }} disabled={busy}>요청 취소</Button> : null}{resumable ? <Button ref={resumeRef} variant="outline" onClick={() => { setError(''); setResumeOpen(true); }}>요청 재개</Button> : null}</div>
    </div>
    {loading ? <p role="status">불러오는 중…</p> : null}{loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
    {request && activity ? <div className="min-w-0 space-y-6 rounded-[var(--radius-surface)] border border-border/70 bg-background p-4 sm:p-6" aria-busy={loading}>
      <header className="min-w-0 space-y-2">
        <h1 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{request.title}</h1>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{AI_REQUEST_STATUS_LABELS[request.status]}</span>
        <span>요청자 {request.requesterName ?? '이름 없음'}</span>
        <time dateTime={request.createdAt}>{aiRequestDate(request.createdAt)}</time>
        </p>{activity.claim?.leaseState === 'expired' ? <p role="status" className="text-sm">처리 시간이 만료되었습니다. 작업 결과 확인이 필요합니다.</p> : null}</header>
      <section aria-label="요청 내용">
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{request.body}</p>
        </section>
      {request.result ? <section aria-labelledby="ai-result-title">
            <h2 id="ai-result-title" className="mb-2 text-base font-semibold">처리 결과</h2>
            <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{request.result}</p>
            </section> : null}
      {request.notifyOnDone ? <p className="text-sm text-muted-foreground">완료 알림: {activity.notification?.state === 'sent' ? '전송됨' : activity.notification?.reason ? '전송 확인 필요' : activity.notification ? '대기' : '등록 대기'}</p> : null}
      <AiAgentRequestActivity activity={activity} service={service}/>
      {!terminal ? <MessageEditor key={request.openQuestionId ?? 'comment'} service={service} activity={activity} onDirtyChange={onDirtyChange} onSaved={savedRequest => { setActivity(value => value ? { ...value, request: savedRequest } : value); setMessage('답변을 저장했습니다.'); setRevision(value => value + 1); }}/> : null}
    </div> : null}
    {message ? <ActionFeedback message={message} onDismiss={() => setMessage('')}/> : null}
    <Dialog open={cancelOpen} onOpenChange={open => { if (!busy)
        setCancelOpen(open); }}>
    <ConfirmationDialogContent title="요청 취소" description="이 요청의 이후 처리를 중단합니다. 기존 작업 이력은 남습니다." confirmLabel="취소" onConfirm={() => void cancel()} onCancel={() => setCancelOpen(false)} busy={busy} error={error} returnFocusRef={cancelRef}/>
    </Dialog>
    <Dialog open={resumeOpen} onOpenChange={setResumeOpen}>
    <FormDialogContent title="요청 재개" description="기존 작업 결과를 확인한 뒤 요청을 다시 대기 상태로 변경합니다." submitLabel="요청 재개" cancelLabel="요청 재개 닫기" onSubmit={resume} onCancel={() => setResumeOpen(false)} busy={busy} submitDisabled={!confirmed || !reason.trim()} error={error} returnFocusRef={resumeRef}>
    <div className="grid gap-2">
    <Label htmlFor="ai-resume-reason">확인 근거</Label>
    <Textarea id="ai-resume-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000}/>
    </div>
    <div className="flex items-center gap-2">
    <Checkbox id="ai-resume-confirmed" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)}/>
    <Label htmlFor="ai-resume-confirmed">기존 작업 결과를 확인했습니다.</Label>
    </div>
    </FormDialogContent>
    </Dialog>
    {draft.confirmation}
  </div>;
}
function MessageEditor({ service, activity, onDirtyChange, onSaved }: {
    service: AiAgentRequestService;
    activity: AiActivity;
    onDirtyChange: (dirty: boolean) => void;
    onSaved: (request: AiRequest) => void;
}) {
    const request = activity.request;
    const questionId = request.status === 'question' ? request.openQuestionId : null;
    const scope = `request:${request.id}:${questionId ?? 'comment'}`;
    const attempt = getAiRequestAttempt<{
        message: AiMessageInput;
        version: string;
    }>(service.actor, `request:${request.id}:message`);
    const busy = useSyncExternalStore(attempt.subscribe, () => attempt.busy, () => false);
    const priorQuestion = attempt.pending?.payload.message.kind === 'answer' ? attempt.pending.payload.message.questionId : null;
    const [text, setText] = useState(readAiRequestDraft<string>(service.actor, scope) ?? (priorQuestion ? readAiRequestDraft<string>(service.actor, `request:${request.id}:${priorQuestion}`) : undefined) ?? '');
    const [error, setError] = useState('');
    const currentText = useRef(text);
    useLayoutEffect(() => { currentText.current = text; }, [text]);
    useEffect(() => { onDirtyChange(Boolean(text)); if (service.active())
        writeAiRequestDraft(service.actor, scope, text); }, [text, scope, service, onDirtyChange]);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || !text.trim() || !service.active())
            return;
        if (request.status === 'question' && !questionId)
            return;
        const message: AiMessageInput = questionId ? { kind: 'answer', questionId, text } : { kind: 'comment', text };
        setError('');
        try {
            const outcome = await attempt.submit({ message, version: request.version }, (payload, key) => service.message(request.id, payload.message, payload.version, key));
            if (outcome && service.active()) {
                const receipt = outcome.receipt.request;
                const savedRequest: AiRequest = BigInt(receipt.version) < BigInt(request.version) ? request : { ...request, ...receipt, openQuestionId: receipt.status === 'question' ? ('openQuestionId' in receipt ? receipt.openQuestionId : request.openQuestionId) : null };
                if (currentText.current === outcome.submitted.message.text) {
                    setText('');
                    deleteAiRequestDraft(service.actor, scope);
                }
                else {
                    // An accepted answer closes its question. Keep later input visible in the
                    // receipt's current editor scope so it cannot answer the closed question.
                    const nextQuestion = savedRequest.status === 'question' ? savedRequest.openQuestionId : null;
                    const nextScope = `request:${request.id}:${nextQuestion ?? 'comment'}`;
                    if (nextScope !== scope) {
                        writeAiRequestDraft(service.actor, nextScope, currentText.current);
                        deleteAiRequestDraft(service.actor, scope);
                    }
                }
                onSaved(savedRequest);
            }
        }
        catch (failure) {
            if (service.active())
                setError(aiRequestErrorMessage(failure));
        }
    };
    return <form onSubmit={submit} className="grid gap-3">
    <div className="grid gap-2">
    <Label htmlFor="ai-message-text">{questionId ? '질문에 답변' : '추가 내용'}</Label>
    <Textarea id="ai-message-text" name="message" value={text} onChange={event => setText(event.target.value)} rows={5} maxLength={5000} required/>
    </div>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex justify-end">
    <Button type="submit" disabled={busy || !text.trim()}>{busy ? '저장 중…' : attempt.pending ? '저장 결과 확인' : questionId ? '답변 저장' : '추가 내용 저장'}</Button>
    </div>
    </form>;
}
