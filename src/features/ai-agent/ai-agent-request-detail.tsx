"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { type AiRequestActor } from './ai-agent-request-access';
import { type AiActivity, aiRequestErrorMessage } from './ai-agent-request-service';
import { useAiAgentRequestActorBoundary, useAiAgentRequestService, type AiRequestBoundary } from './use-ai-agent-requests';
import { AI_REQUEST_STATUS_LABELS, aiRequestDate } from './ai-agent-request-format';
import { AiAgentRequestActivity } from './ai-agent-request-activity';

export function AiAgentRequestDetail({ id }: { id: string }) {
  const boundary = useAiAgentRequestActorBoundary();
  if (boundary.loading) return <p role="status">권한 확인 중…</p>;
  if (!boundary.actor) return <p role="alert">AI 요청에 접근할 권한이 없습니다.</p>;
  return <RequestDetail key={`${boundary.actor.userId}:${boundary.actor.role}:${boundary.recoveryRevision}:${id}`} id={id} actor={boundary.actor} boundary={boundary} />;
}

function RequestDetail({ id, actor, boundary }: { id: string; actor: AiRequestActor; boundary: AiRequestBoundary }) {
  const service = useAiAgentRequestService(boundary, actor);
  const [activity, setActivity] = useState<AiActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
    useEffect(() => { const controller = new AbortController(); let active = true; queueMicrotask(() => { if (active) {
        setLoading(true);
        setLoadError('');
    } }); void Promise.all([service.activity(id, controller.signal), service.actions(id, controller.signal)]).then(([value, actions]) => { if (active && service.active())
        setActivity({ ...value, actions }); }).catch(failure => { if (active && service.active())
        setLoadError(aiRequestErrorMessage(failure)); }).finally(() => { if (active && service.active())
        setLoading(false); }); return () => { active = false; controller.abort(); }; }, [id, service, revision]);
  const request = activity?.request;
  return <div className="mx-auto w-full min-w-0 max-w-[1560px] space-y-4 px-4 sm:px-5 lg:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link href="/admin/ai-agent" prefetch={false} className="text-sm hover:underline">이전 요청 목록</Link>
      <Button variant="outline" onClick={() => setRevision(value => value + 1)} disabled={loading}>새로고침</Button>
    </div>
    <p className="text-sm text-muted-foreground">이전 요청의 읽기 전용 이력입니다. 기록된 완료 상태와 실제 업무 반영 결과는 다를 수 있습니다.</p>
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
    </div> : null}
  </div>;
}
