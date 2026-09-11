import { installUnsavedHistoryDispatcher } from "./lib/unsaved-history-fallback";

// Next runs this entry before hydration and router popstate subscriptions.
// Native Navigation API guards leave the dispatcher inactive.
installUnsavedHistoryDispatcher(window);
