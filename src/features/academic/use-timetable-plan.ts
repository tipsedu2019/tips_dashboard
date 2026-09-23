'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { createTimetablePlanController, type TimetableItemEdit, type TimetableControllerState } from './timetable-plan-model.ts';
import { createTimetablePlanService, watchTimetablePlan, type TimetableRpcClient, type TimetableSignalClient } from './timetable-plan-service.ts';

const EMPTY: TimetableControllerState = { snapshot: null, draft: null, saveState: 'idle', conflicts: [], error: null,
  referenceStatus: 'unknown', recoveryAvailable: true, dirty: false };
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/** A scoped editor. Task 6 owns navigation confirmation via useDraftNavigation(state.dirty). */
export function useTimetablePlan(planId: string | null) {
  const { user, role, loading } = useAuth();
  const actorScope = !loading && user?.id && role ? `${user.id}:${role}` : null;
  const controller = useMemo(() => {
    if (!supabase || !actorScope || !planId) return null;
    const service = createTimetablePlanService({ client: supabase as unknown as TimetableRpcClient, actorScope });
    return createTimetablePlanController({ service, actorScope, planId });
  }, [actorScope, planId]);
  const latestActor = useRef(actorScope);
  useLayoutEffect(() => { latestActor.current = actorScope; }, [actorScope]);
  useEffect(() => {
    if (!controller || !planId) return;
    void controller.load();
    const stop = supabase ? watchTimetablePlan({
      client: supabase as unknown as TimetableSignalClient, actorScope: actorScope!, planId,
      onInvalidate: () => { void controller.refresh(); },
      onPoll: () => { void controller.checkRevision(); },
      environment: { document, window },
    }) : () => {};
    return () => {
      stop();
      if (latestActor.current !== actorScope) controller.clearSensitive();
      controller.destroy();
    };
  }, [controller, actorScope, planId]);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe,
    controller?.snapshot ?? emptySnapshot, emptySnapshot);
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
  return { ...state, dispatch, retry, refresh, resolveStale, undo, controller };
}
