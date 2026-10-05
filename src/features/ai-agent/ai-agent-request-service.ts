import { z } from 'zod';
import { aiRequestSchema, aiRequestListSchema, aiRequestListQuerySchema, aiCreateRequestSchema, aiMessageInputSchema, aiMessageMutationSchema, aiActivitySchema, aiActionsSchema, aiActionJournalSchema, aiSpaceCatalogSchema, aiSpacePermissionSchema, aiPolicySpaceKeysSchema, type AiCreateRequest, type AiMessageInput, type AiRequestListQuery } from './ai-agent-request-contract';
import { sameAiRequestActor, type AiRequestActor } from './ai-agent-request-access';

export type AiActivity = z.infer<typeof aiActivitySchema>;
export type AiSpaceCatalog = z.infer<typeof aiSpaceCatalogSchema>;
export type AiSpacePermission = z.infer<typeof aiSpacePermissionSchema>;
export type AiRequestSession = { user: { id: string }; access_token: string } | null;
export class AiRequestServiceError extends Error {
  constructor(public code: string, public definite: boolean) { super(code); }
}
export function aiRequestErrorMessage(error: unknown) {
  if (error instanceof AiRequestServiceError && ['ai_agent_stale_version','ai_agent_conflict','ai_agent_question_conflict','ai_agent_terminal','ai_agent_effect_unresolved'].includes(error.code)) return '다른 변경사항이 있습니다. 새로고침한 뒤 다시 저장해 주세요.';
  if (error instanceof AiRequestServiceError && ['ai_agent_forbidden','ai_agent_unauthorized'].includes(error.code)) return '이 요청에 접근할 권한이 없습니다.';
  return '결과를 확인하지 못했습니다. 입력을 유지했습니다. 다시 시도해 주세요.';
}
export function createAiAgentRequestService({ actor, getCurrentActor, getSession, fetcher = fetch }: {
  actor: AiRequestActor; getCurrentActor: () => AiRequestActor | null;
  getSession: () => Promise<AiRequestSession>; fetcher?: typeof fetch;
}) {
  let disposed = false;
  let lifecycle = 0;
  const active = () => !disposed && sameAiRequestActor(actor, getCurrentActor());
  const checkActor = (expected = lifecycle) => { if (!active() || expected !== lifecycle) throw new AiRequestServiceError('actor_changed', false); };
  async function send<T>(path: string, schema: z.ZodType<T>, options: { method?: string; body?: unknown; key?: string; version?: string; allowZeroVersion?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    const activation = lifecycle;
    checkActor(activation);
    const session = await getSession();
    checkActor(activation);
    if (!session || session.user.id !== actor.userId || !session.access_token) throw new AiRequestServiceError('actor_session_mismatch', false);
    const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.key) headers['Idempotency-Key'] = z.uuid().parse(options.key);
    if (options.version !== undefined) {
      if (!(options.allowZeroVersion ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(options.version)) throw new AiRequestServiceError('invalid_version', true);
      headers['If-Match'] = `"r${options.version}"`;
    }
    checkActor(activation);
    const response = await fetcher(`/api/ai-agent/${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), cache: 'no-store' });
    checkActor(activation);
    const envelope = await response.json();
    checkActor(activation);
    if (!response.ok || envelope.error !== null || envelope.data === null) throw new AiRequestServiceError(typeof envelope.error?.code === 'string' ? envelope.error.code : 'invalid_response', response.status >= 400 && response.status < 500);
    const parsed = schema.safeParse(envelope.data);
    if (!parsed.success) throw new AiRequestServiceError('invalid_response', false);
    return parsed.data;
  }
  const requestPath = (id: string) => `requests/${z.uuid().parse(id)}`;
  return {
    actor, active,
    mount() { lifecycle++; disposed = !sameAiRequestActor(actor, getCurrentActor()); return !disposed; },
    dispose() { lifecycle++; disposed = true; },
    list(input: AiRequestListQuery, signal?: AbortSignal) {
      const query = aiRequestListQuerySchema.parse(input);
      if (query.scope === 'all' && actor.role !== 'admin') throw new AiRequestServiceError('forbidden', true);
      const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
      return send(`requests?${search}`, aiRequestListSchema, {signal});
    },
    create(input: AiCreateRequest, key: string) { return send('requests', aiRequestSchema, {method:'POST',body:aiCreateRequestSchema.parse(input),key}); },
    async activity(id: string, signal?: AbortSignal) {
      const activation = lifecycle;
      let result: AiActivity | null = null;
      let messageSeq = '', eventSeq = '';
      const seen = new Set<string>();
      do {
        const query = new URLSearchParams({...(messageSeq?{afterMessageSeq:messageSeq}:{}),...(eventSeq?{afterEventSeq:eventSeq}:{}),limit:'50'});
        const page = await send(`${requestPath(id)}?${query}`, aiActivitySchema, {signal});
        checkActor(activation);
        if (!result) result = {...page,messages:[],events:[],actions:[]};
        result.request = page.request; result.claim = page.claim; result.notification = page.notification;
        for (const item of page.messages) if (!result.messages.some(value=>value.id===item.id)) result.messages.push(item);
        for (const item of page.events) if (!result.events.some(value=>value.id===item.id)) result.events.push(item);
        for (const item of page.actions) if (!result.actions.some(value=>value.id===item.id)) result.actions.push(item);
        const next = `${page.nextMessageSeq ?? 'end'}:${page.nextEventSeq ?? 'end'}`;
        if (seen.has(next) && (page.nextMessageSeq || page.nextEventSeq)) throw new AiRequestServiceError('invalid_cursor',false);
        seen.add(next);
        // Finished streams keep their last observed sequence while the other stream continues.
        messageSeq = page.nextMessageSeq ?? page.messages[page.messages.length - 1]?.seq ?? messageSeq;
        eventSeq = page.nextEventSeq ?? page.events[page.events.length - 1]?.seq ?? eventSeq;
        result.nextMessageSeq = page.nextMessageSeq; result.nextEventSeq = page.nextEventSeq;
      } while (result.nextMessageSeq || result.nextEventSeq);
      return result;
    },
    message(id:string, input:AiMessageInput, version:string, key:string) { return send(`${requestPath(id)}/messages`,aiMessageMutationSchema,{method:'POST',body:aiMessageInputSchema.parse(input),version,key}); },
    cancel(id:string, version:string, key:string) { return send(requestPath(id),aiRequestSchema,{method:'PATCH',body:{status:'cancelled'},version,key}); },
    resume(id:string, reason:string, version:string, key:string) { return send(`${requestPath(id)}/resume`,aiRequestSchema,{method:'POST',body:{reason,confirmed:true},version,key}); },
    async actions(id:string, signal?:AbortSignal) {
      const activation = lifecycle;
      const items: z.infer<typeof aiActionsSchema>['items'] = []; let cursor: string | null = null; const seen=new Set<string>();
      do { const query:URLSearchParams=new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}); const page:z.infer<typeof aiActionsSchema>=await send(`${requestPath(id)}/actions?${query}`,aiActionsSchema,{signal}); checkActor(activation); items.push(...page.items); cursor=page.nextCursor; if(cursor && seen.has(cursor)) throw new AiRequestServiceError('invalid_cursor',false); if(cursor) seen.add(cursor); } while(cursor);
      return items;
    },
    async actionJournal(id:string, actionId:string, signal?:AbortSignal) {
      const activation = lifecycle;
      let cursor:string|null=null; let result:z.infer<typeof aiActionJournalSchema>|null=null; const seen=new Set<string>();
      do { const query:URLSearchParams=new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}); const page:z.infer<typeof aiActionJournalSchema>=await send(`${requestPath(id)}/actions/${z.uuid().parse(actionId)}?${query}`,aiActionJournalSchema,{signal}); checkActor(activation); result=result?{...page,events:[...result.events,...page.events]}:{...page}; cursor=page.nextCursor; if(cursor&&seen.has(cursor)) throw new AiRequestServiceError('invalid_cursor',false); if(cursor)seen.add(cursor); } while(cursor); return result;
    },
    spaces: (signal?:AbortSignal) => send('spaces',aiSpaceCatalogSchema,{signal}),
    permission: (userId:string, signal?:AbortSignal) => send(`space-permissions/${z.uuid().parse(userId)}`,aiSpacePermissionSchema,{signal}),
    setPermission: (userId:string, spaceKeys:AiSpacePermission['spaceKeys'], version:string,key:string) => send(`space-permissions/${z.uuid().parse(userId)}`,aiSpacePermissionSchema,{method:'PATCH',body:{spaceKeys:aiPolicySpaceKeysSchema.parse(spaceKeys)},version,key,allowZeroVersion:true}),
  };
}
export type AiAgentRequestService = ReturnType<typeof createAiAgentRequestService>;
