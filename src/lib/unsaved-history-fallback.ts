type Resume = () => void;
type Phase = "waiting" | "armed" | "restoring" | "releasing" | "released";
type Snapshot = { state: unknown; url: string };
type Marker = { token: string; role: "base" | "sentinel"; originalState?: unknown };

const MARKER = "__tipsUnsavedHistory";
let nextToken = 0;

type Session = {
  dispose: () => void;
  release: (after?: Resume) => void;
  afterRelease: (listener: Resume) => void;
  ownsCurrentSentinel: () => boolean;
};
const sessions = new WeakMap<Window, Session>();
type PopStateHandler = (event: PopStateEvent) => void;
type Dispatcher = { subscribe: (handler: PopStateHandler) => () => void };
const dispatchers = new WeakMap<Window, Dispatcher>();

/** Install from instrumentation-client before the router hydrates. Window
 * popstate listeners run in registration order, even with capture=true. The
 * dispatcher is inert unless a legacy dirty lifetime owns its subscription. */
export function installUnsavedHistoryDispatcher(browser: Window): Dispatcher {
  const installed = dispatchers.get(browser);
  if (installed) return installed;
  let activeHandler: PopStateHandler | undefined;
  const dispatcher: Dispatcher = {
    subscribe(handler) {
      activeHandler = handler;
      return () => {
        if (activeHandler === handler) activeHandler = undefined;
      };
    },
  };
  browser.addEventListener("popstate", event => activeHandler?.(event));
  dispatchers.set(browser, dispatcher);
  return dispatcher;
}

/** Local query changes retain drafts. Legacy guards fold these into their owned
 * entry; external routes still use the router after confirmed guard release. */
export function pushLocalHistoryState(browser: Window, data: unknown, unused: string, url?: string | URL | null) {
  if (sessions.get(browser)?.ownsCurrentSentinel()) browser.history.replaceState(data, unused, url);
  else browser.history.pushState(data, unused, url);
}

/**
 * Legacy-browser fallback only. Arming a sentinel truncates an existing forward
 * branch. History cannot delete one entry: release retires the forward duplicate
 * to the same URL/state, then leaves the browser on the original base entry.
 * Next's opaque history fields are preserved, never reconstructed.
 */
export function createUnsavedHistoryFallback(
  browser: Window,
  onAttempt: (resume: Resume) => void,
): { dispose: () => void; release: (after?: Resume) => void } {
  const previous = sessions.get(browser);
  const token = `tips-unsaved-${++nextToken}`;
  let phase: Phase = "waiting";
  let releaseRequested = false;
  let attemptsDisabled = false;
  let approvedIntent: Resume | undefined;
  let attemptGeneration = 0;
  let traversalConsumed = false;
  let restorationSteps = 0;
  let targetWasBase = false;
  let releaseSnapshot: Snapshot | null = null;
  let originalReplace: History["replaceState"] | null = null;
  let unsubscribe: (() => void) | undefined;
  const releasedListeners: Resume[] = [];
  const executedIntents = new WeakSet<Resume>();
  const executeOnce = (intent?: Resume) => {
    if (!intent || executedIntents.has(intent)) return;
    executedIntents.add(intent);
    intent();
  };

  const markerOf = (state: unknown): Marker | null => {
    if (!state || typeof state !== "object") return null;
    const marker = (state as Record<string, unknown>)[MARKER];
    if (!marker || typeof marker !== "object") return null;
    const value = marker as Marker;
    return value.token === token && (value.role === "base" || value.role === "sentinel") ? value : null;
  };
  const stripMarker = (state: unknown): unknown => {
    const marker = markerOf(state);
    if (!marker) return state;
    const copy = { ...(state as Record<string, unknown>) };
    delete copy[MARKER];
    if (Object.keys(copy).length === 0 && "originalState" in marker) return marker.originalState;
    return copy;
  };
  const mark = (state: unknown, role: Marker["role"]) => ({
    ...(state && typeof state === "object" ? state : {}),
    [MARKER]: { token, role, ...(!state || typeof state !== "object" ? { originalState: state } : {}) },
  });
  const replace = (state: unknown, url: string | URL | null | undefined) => {
    originalReplace?.call(browser.history, state, "", url);
  };

  // Keep our ownership through Next's same-document URL replacements without
  // changing their URL, opaque router state, or normal push/replace behavior.
  const trackedReplace: History["replaceState"] = function (data, unused, url) {
    const currentMarker = markerOf(browser.history.state);
    const nextState = currentMarker && phase !== "released"
      ? mark(data, currentMarker.role)
      : data;
    originalReplace?.call(browser.history, nextState, unused, url);
  };

  const finish = () => {
    if (phase === "released") return;
    phase = "released";
    unsubscribe?.();
    unsubscribe = undefined;
    if (originalReplace && browser.history.replaceState === trackedReplace) {
      browser.history.replaceState = originalReplace;
    }
    if (sessions.get(browser) === session) sessions.delete(browser);
    const intent = approvedIntent;
    approvedIntent = undefined;
    try {
      executeOnce(intent);
    } finally {
      for (const listener of releasedListeners.splice(0)) listener();
    }
  };

  const startRelease = () => {
    if (phase !== "armed") return;
    // An unrelated navigation may already have left our owned entry. Never
    // traverse backward from, or overwrite, that new route during unmount.
    if (markerOf(browser.history.state)?.role !== "sentinel") {
      finish();
      return;
    }
    releaseSnapshot = {
      state: stripMarker(browser.history.state),
      url: browser.location.href,
    };
    phase = "releasing";
    // Retire the forward copy too, so Forward cannot restore stale form URLs.
    replace(releaseSnapshot.state, releaseSnapshot.url);
    browser.history.back();
  };

  function handlePopState(event: PopStateEvent) {
    if (phase === "waiting" || phase === "released") return;
    // The early dispatcher must receive this before Next publishes the
    // traversed route, or that render can dispose the still-dirty editor.
    event.stopImmediatePropagation();
    if (phase === "releasing") {
      if (releaseSnapshot) replace(releaseSnapshot.state, releaseSnapshot.url);
      finish();
      return;
    }
    if (phase === "restoring") {
      restorationSteps += 1;
      if (markerOf(event.state)?.role !== "sentinel") {
        browser.history.forward();
        return;
      }
      phase = "armed";
      if (releaseRequested) {
        startRelease();
        return;
      }
      // The caller may already be confirming the first Back intent and ignore
      // later attempts. All callbacks from this lifetime remain valid until one
      // is accepted; accepting any one invalidates the others.
      const generation = attemptGeneration;
      const remainingSteps = restorationSteps + (targetWasBase ? 1 : 0) - 1;
      let resumed = false;
      const traverse = () => {
        if (resumed || traversalConsumed || generation !== attemptGeneration) return;
        resumed = true;
        traversalConsumed = true;
        if (remainingSteps > 0) browser.history.go(-remainingSteps);
      };
      if (!attemptsDisabled) onAttempt(() => {
        if (generation !== attemptGeneration || resumed || traversalConsumed) return;
        if (phase === "released") traverse();
        else session.release(traverse);
      });
      return;
    }
    if (markerOf(event.state)?.role === "sentinel") return;
    phase = "restoring";
    restorationSteps = 0;
    targetWasBase = markerOf(event.state)?.role === "base";
    browser.history.forward();
  }

  const release = (after?: Resume) => {
    if (phase === "released") {
      executeOnce(after);
      return;
    }
    releaseRequested = true;
    approvedIntent ??= after;
    startRelease();
  };
  const session: Session = {
    ownsCurrentSentinel: () => phase !== "released" && markerOf(browser.history.state)?.role === "sentinel",
    release,
    dispose: () => {
      attemptsDisabled = true;
      if (!approvedIntent) attemptGeneration += 1;
      release();
    },
    afterRelease: (listener) => {
      if (phase === "released") listener();
      else releasedListeners.push(listener);
    },
  };
  sessions.set(browser, session);

  const activate = () => {
    if (releaseRequested || browser.history.length <= 1) {
      finish();
      return;
    }
    originalReplace = browser.history.replaceState;
    const snapshot = { state: browser.history.state, url: browser.location.href };
    replace(mark(snapshot.state, "base"), snapshot.url);
    browser.history.pushState(mark(snapshot.state, "sentinel"), "", snapshot.url);
    browser.history.replaceState = trackedReplace;
    unsubscribe = installUnsavedHistoryDispatcher(browser).subscribe(handlePopState);
    phase = "armed";
  };
  if (previous) {
    previous.afterRelease(activate);
    previous.dispose();
  } else activate();

  return { release, dispose: session.dispose };
}
