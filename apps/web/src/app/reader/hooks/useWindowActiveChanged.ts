// Runs a callback when the page becomes visible or hidden.

import { useEffect, useRef } from 'react';

export type ActiveCallback = (isActive: boolean) => void;

export function useWindowActiveChanged(callback: ActiveCallback) {
  const onActiveChanged = useRef<ActiveCallback>(callback);

  useEffect(() => {
    onActiveChanged.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = () => onActiveChanged.current?.(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
}
