import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { clearTimetableActorRecovery, observeTimetableActorRetirement, observeTimetablePlanRevocation } from './timetable-plan-recovery.ts';
import { watchTimetablePlan, type TimetableSignalClient } from './timetable-plan-service.ts';
import type { createTimetablePlanController, TimetableControllerState } from './timetable-plan-model.ts';

const EMPTY: TimetableControllerState = { snapshot: null, draft: null, saveState: 'idle', conflicts: [], error: null,
  referenceStatus: 'unknown', recoveryAvailable: true, dirty: false, pendingOperations: [] };
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;
type Controller = ReturnType<typeof createTimetablePlanController>;

/** Owns the live controller effect. React may replay setup/cleanup/setup in StrictMode. */
export function useTimetablePlanSession({ controller, actorScope, planId, signalClient }: {
  controller: Controller | null; actorScope: string | null; planId: string | null;
  signalClient: TimetableSignalClient | null;
}): TimetableControllerState {
  const latestActor = useRef(actorScope);
  useLayoutEffect(() => { latestActor.current = actorScope; }, [actorScope]);
  useEffect(() => {
    if (!controller || !planId || !actorScope) return;
    controller.resume();
    const stopRetirement = observeTimetableActorRetirement(actorScope, () => {
      controller.clearSensitive(); controller.destroy();
    });
    const stopRevocation = observeTimetablePlanRevocation(actorScope, id => {
      if (id === planId) { controller.clearSensitive(); controller.destroy(); }
    });
    void controller.load();
    const stop = signalClient ? watchTimetablePlan({
      client: signalClient, actorScope, planId,
      onInvalidate: () => { void controller.refresh(); },
      onPoll: () => { void controller.checkRevision(); },
      environment: { document, window },
    }) : () => {};
    return () => {
      stop();
      stopRetirement(); stopRevocation();
      if (latestActor.current !== actorScope) {
        controller.clearSensitive();
        clearTimetableActorRecovery(actorScope);
        controller.destroy();
      } else controller.pause();
    };
  }, [controller, actorScope, planId, signalClient]);
  return useSyncExternalStore(controller?.subscribe ?? noSubscribe,
    controller?.snapshot ?? emptySnapshot, emptySnapshot);
}
