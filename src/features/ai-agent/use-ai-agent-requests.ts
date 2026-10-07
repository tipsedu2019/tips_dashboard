'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { supabase } from '@/lib/supabase';
import { createNumberedPageController, type NumberedPageSnapshot } from '@/lib/numbered-page-controller';
import { type DataTablePageSize } from '@/lib/numbered-pagination';
import { synchronizeAiRequestRecoveryActor, subscribeAiRequestRecovery, getAiRequestRecoveryRevision } from './ai-agent-request-recovery';
import { resolveAiAgentRequestAccess, type AiRequestActor } from './ai-agent-request-access';
import { createAiAgentRequestService, type AiAgentRequestService, AiRequestServiceError } from './ai-agent-request-service';
import { type AiRequest, type AiRequestListQuery } from './ai-agent-request-contract';
/** The outer owner publishes this boundary during commit; keyed children never expose another actor's state. */
export function useAiAgentRequestActorBoundary() {
    const auth = useAuth();
    const access = resolveAiAgentRequestAccess({ role: auth.role, isFallbackRole: auth.user?.isFallbackRole, loading: auth.loading });
    const userId = auth.user?.id;
    const actor = useMemo(() => access.canUseRequests && userId ? { userId, role: auth.role } : null, [access.canUseRequests, userId, auth.role]);
    const current = useRef({ actor, session: auth.session });
    const recoveryRevision = useSyncExternalStore(subscribeAiRequestRecovery, getAiRequestRecoveryRevision, () => 0);
    // Keyed children synchronously hide the prior actor at render. Publish the live
    // authorization boundary in the same commit, before events or async feedback.
    useLayoutEffect(() => {
        current.current = { actor, session: auth.session };
        // The global provider handles changes even off-route. This boundary also
        // protects independently mounted feature consumers before browser paint.
        synchronizeAiRequestRecoveryActor(actor);
    }, [actor, auth.session]);
    const getCurrentActor = useCallback(() => current.current.actor, []);
    const getSession = useCallback(async () => {
        const captured = current.current;
        if (!captured.actor || captured.session?.user.id !== captured.actor.userId || !supabase)
            throw new AiRequestServiceError('actor_session_mismatch', false);
        const { data, error } = await supabase.auth.getSession();
        if (error || current.current.actor?.userId !== captured.actor.userId || current.current.actor?.role !== captured.actor.role || current.current.session?.user.id !== captured.actor.userId || data.session?.user.id !== captured.actor.userId)
            throw new AiRequestServiceError('actor_changed', false);
        return data.session;
    }, []);
    return { actor, access, getCurrentActor, getSession, recoveryRevision, loading: auth.loading, requesterName: auth.user?.name ?? '내 계정' };
}
export type AiRequestBoundary = ReturnType<typeof useAiAgentRequestActorBoundary>;
export function useAiAgentRequestService(boundary: AiRequestBoundary, actor: AiRequestActor) {
    const service = useMemo(() => createAiAgentRequestService({ actor, getCurrentActor: boundary.getCurrentActor, getSession: boundary.getSession }), [actor, boundary.getCurrentActor, boundary.getSession]);
    // Activate before descendant passive reads, including StrictMode replay.
    // The outer boundary publishes the committed actor later in this layout
    // phase; each service operation still checks that live actor itself.
    useLayoutEffect(() => { service.mount(); return () => service.dispose(); }, [service]);
    return service;
}
export function useAiAgentRequests({ service, page, pageSize, scope, status, search, ready }: {
    service: AiAgentRequestService;
    page: number;
    pageSize: DataTablePageSize;
    scope: 'own' | 'all';
    status: AiRequestListQuery['status'];
    search: string;
    ready: boolean;
}) {
    const [snapshot, setSnapshot] = useState<NumberedPageSnapshot<AiRequest>>({ scope: null, requestedPage: 1, page: 1, pageSize, totalCount: null, rows: [], loading: true, error: null });
    const controller = useMemo(() => createNumberedPageController<AiRequest>({
        async loadPage(input) { const query = JSON.parse(input.scope) as Pick<AiRequestListQuery, 'scope' | 'status' | 'search'>; const result = await service.list({ ...query, page: input.page, pageSize: input.pageSize }, input.signal); return { rows: result.items, totalCount: result.total, page: result.page, pageSize: result.pageSize }; },
        onChange: value => { if (service.active())
            setSnapshot(value); },
    }), [service]);
    const query = JSON.stringify({ scope, ...(status ? { status } : {}), ...(search ? { search } : {}) });
    useEffect(() => { if (ready)
        void controller.load({ scope: query, page, pageSize }); }, [controller, query, page, pageSize, ready]);
    useEffect(() => () => controller.dispose(), [controller]);
    return { snapshot, retry: controller.retry };
}
