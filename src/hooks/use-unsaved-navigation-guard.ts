"use client";

import { useCallback, useEffect, useRef } from "react";
import { createUnsavedHistoryFallback } from "@/lib/unsaved-history-fallback";
import { APP_NAVIGATION_REQUEST, type AppNavigationRequest } from "@/lib/guarded-navigation";

type NavigationIntent = () => void;

// TS 5.9 does not include the Navigation interface yet. Keep the optional
// platform boundary here; the application's router remains responsible for UI.
type TraverseEvent = Event & {
  navigationType: string;
  destination: { key: string; url: string; sameDocument: boolean };
};
type BrowserNavigation = EventTarget & {
  traverseTo: (key: string) => { committed: Promise<unknown>; finished: Promise<unknown> };
};

type Options = {
  enabled: boolean;
  onConfirmRequest: () => void;
  navigate: (href: string) => void;
};

/** Protect a draft without replacing Next's router or intercepting its URL writes. */
export function useUnsavedNavigationGuard({ enabled, onConfirmRequest, navigate }: Options) {
  const pendingRef = useRef<{ intent: NavigationIntent; preserveHistory: boolean } | null>(null);
  const fallbackRef = useRef<ReturnType<typeof createUnsavedHistoryFallback> | null>(null);
  const allowedTraversalRef = useRef<string | null>(null);

  const runIntent = useCallback((intent: NavigationIntent) => {
    if (fallbackRef.current) fallbackRef.current.release(intent);
    else intent();
  }, []);
  const requestNavigation = useCallback((intent: NavigationIntent, options: { skipConfirmation?: boolean; preserveHistory?: boolean } = {}) => {
    if (!enabled) {
      // The last draft may just have become clean while legacy cleanup is still
      // traversing. A local push must wait for that owned traversal to finish.
      runIntent(intent);
      return;
    }
    if (options.skipConfirmation) {
      if (options.preserveHistory) intent();
      else runIntent(intent);
      return;
    }
    // Repeated Back/clicks must not overwrite the action already being confirmed.
    if (pendingRef.current) return;
    pendingRef.current = { intent, preserveHistory: Boolean(options.preserveHistory) };
    onConfirmRequest();
  }, [enabled, onConfirmRequest, runIntent]);

  const cancelNavigation = useCallback(() => {
    pendingRef.current = null;
  }, []);

  const confirmNavigation = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    // Local edits/partial discards stay on this page and may leave other drafts.
    // Their confirmation must not retire the legacy Back protection.
    if (pending.preserveHistory) pending.intent();
    else runIntent(pending.intent);
  }, [runIntent]);

  useEffect(() => {
    const receiveNavigation = (event: Event) => {
      const detail = (event as AppNavigationRequest).detail;
      const intent = detail?.intent;
      if (typeof intent !== "function") return;
      if (!enabled) {
        // A clean editor must not bypass another mounted editor's dirty guard.
        // Retire any legacy sentinel only when the accepted intent actually runs.
        if (fallbackRef.current) detail.beforeNavigate?.push(runIntent);
        return;
      }
      if (event.defaultPrevented) return;
      event.preventDefault();
      requestNavigation(intent);
    };
    window.addEventListener(APP_NAVIGATION_REQUEST, receiveNavigation);
    return () => window.removeEventListener(APP_NAVIGATION_REQUEST, receiveNavigation);
  }, [enabled, requestNavigation, runIntent]);

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = null;
      return;
    }
    const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const captureLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      requestNavigation(() => navigate(`${destination.pathname}${destination.search}${destination.hash}`));
    };
    const captureTraversal = (event: Event) => {
      const traversal = event as TraverseEvent;
      if (traversal.navigationType !== "traverse" || !traversal.destination.sameDocument || !event.cancelable) return;
      if (allowedTraversalRef.current === traversal.destination.key) {
        allowedTraversalRef.current = null;
        return;
      }
      event.preventDefault();
      const key = traversal.destination.key;
      requestNavigation(() => {
        allowedTraversalRef.current = key;
        const result = navigation!.traverseTo(key);
        // Another browser navigation can abort a traversal. Keep the draft and
        // restore protection instead of reporting an unhandled promise rejection.
        void result.committed.catch(() => { allowedTraversalRef.current = null; });
        void result.finished.catch(() => { allowedTraversalRef.current = null; });
      });
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", captureLink, true);
    if (navigation && typeof navigation.traverseTo === "function") {
      navigation.addEventListener("navigate", captureTraversal);
    } else {
      fallbackRef.current = createUnsavedHistoryFallback(window, requestNavigation);
    }
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", captureLink, true);
      navigation?.removeEventListener("navigate", captureTraversal);
      fallbackRef.current?.dispose();
      // Keep the handle until its asynchronous cleanup is done: an immediate
      // save/close/navigation must be queued behind that history restoration.
    };
  }, [enabled, navigate, requestNavigation]);

  return { requestNavigation, cancelNavigation, confirmNavigation };
}
