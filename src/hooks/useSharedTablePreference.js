import { useCallback, useEffect, useRef, useState } from 'react';

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
  const pendingSignatureRef = useRef('');

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
        pendingSignatureRef.current = serialize(nextState);
        setPendingState(null);
        setIsHydrated(true);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setExternalState(null);
        pendingSignatureRef.current = '';
        setPendingState(null);
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
        pendingSignatureRef.current = nextSerialized;
        setPendingState(null);
      } catch {
        pendingSignatureRef.current = '';
        // Local storage fallback remains active in useDataTableControls.
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [canPersist, dataService, isHydrated, pendingState, storageKey]);

  const queuePersist = useCallback((nextState) => {
    const nextSerialized = serialize(nextState);
    if (!nextSerialized) {
      return;
    }

    if (nextSerialized === lastSavedRef.current || nextSerialized === pendingSignatureRef.current) {
      return;
    }

    pendingSignatureRef.current = nextSerialized;
    setPendingState(nextState);
  }, []);

  return {
    externalState,
    isHydrated,
    queuePersist,
  };
}
