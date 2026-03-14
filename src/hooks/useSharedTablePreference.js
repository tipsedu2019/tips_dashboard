import { useEffect, useRef, useState } from 'react';

function serialize(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

export function useSharedTablePreference({ storageKey, dataService, canPersist }) {
  const [externalState, setExternalState] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [pendingState, setPendingState] = useState(null);
  const lastSavedRef = useRef('');

  useEffect(() => {
    let active = true;
    setIsHydrated(false);

    if (!dataService?.getAppPreference) {
      setExternalState(null);
      setIsHydrated(true);
      return () => {
        active = false;
      };
    }

    dataService.getAppPreference(storageKey)
      .then((preference) => {
        if (!active) {
          return;
        }

        const nextState = preference?.value || preference || null;
        setExternalState(nextState);
        lastSavedRef.current = serialize(nextState);
        setIsHydrated(true);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setExternalState(null);
        setIsHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [dataService, storageKey]);

  useEffect(() => {
    if (!canPersist || !isHydrated || !pendingState || !dataService?.setAppPreference) {
      return undefined;
    }

    const nextSerialized = serialize(pendingState);
    if (nextSerialized === lastSavedRef.current) {
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        await dataService.setAppPreference(storageKey, pendingState);
        lastSavedRef.current = nextSerialized;
      } catch {
        // Local storage fallback remains active in useDataTableControls.
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [canPersist, dataService, isHydrated, pendingState, storageKey]);

  return {
    externalState,
    isHydrated,
    queuePersist: setPendingState,
  };
}
