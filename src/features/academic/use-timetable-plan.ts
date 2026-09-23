'use client';

import { useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { createTimetablePlanController, type TimetableItemEdit } from './timetable-plan-model.ts';
import { createTimetablePlanService, type TimetableRpcClient, type TimetableSignalClient } from './timetable-plan-service.ts';
import { useTimetablePlanSession } from './use-timetable-plan-session.ts';

/** A scoped editor. Task 6 owns navigation confirmation via useDraftNavigation(state.dirty). */
export function useTimetablePlan(planId: string | null) {
  const { user, role, loading } = useAuth();
  const actorScope = !loading && user?.id && role ? `${user.id}:${role}` : null;
  const controller = useMemo(() => {
    if (!supabase || !actorScope || !planId) return null;
    const service = createTimetablePlanService({ client: supabase as unknown as TimetableRpcClient, actorScope });
    return createTimetablePlanController({ service, actorScope, planId });
  }, [actorScope, planId]);
  const state = useTimetablePlanSession({ controller, actorScope, planId,
    signalClient: supabase as unknown as TimetableSignalClient | null });
  const dispatch = useCallback((edit: TimetableItemEdit) => controller
    ? controller.dispatch(edit) : Promise.reject(Error('timetable_plan_scope_missing')), [controller]);
  const retry = useCallback((itemId?: string) => controller
    ? controller.retry(itemId) : Promise.reject(Error('timetable_plan_scope_missing')), [controller]);
  const refresh = useCallback(() => controller
    ? controller.refresh() : Promise.resolve(), [controller]);
  const resolveStale = useCallback((itemId: string, choice: 'accept_server' | 'reapply_draft') => controller
    ? controller.resolveStale(itemId, choice) : Promise.reject(Error('timetable_plan_scope_missing')), [controller]);
  const undo = useCallback(() => controller
    ? controller.undo() : Promise.reject(Error('timetable_plan_scope_missing')), [controller]);
  const replaceRejected = useCallback((edit: TimetableItemEdit) => controller
    ? controller.replaceRejected(edit) : Promise.reject(Error('timetable_plan_scope_missing')), [controller]);
  const discardRejected = useCallback((itemId: string) => controller
    ? controller.discardRejected(itemId) : Promise.reject(Error('timetable_plan_scope_missing')), [controller]);
  const failureKind = useCallback((itemId: string) => controller?.failureKind(itemId) ?? null, [controller]);
  return { ...state, replaceRejected, discardRejected, failureKind, dispatch, retry, refresh, resolveStale, undo, controller };
}
