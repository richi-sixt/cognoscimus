import { useEffect, useRef } from 'react';

export const useScreenWakeLock = (lock: boolean) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;
    let shouldHoldWakeLock = lock;
    let requestPending = false;

    const requestWakeLock = async () => {
      shouldHoldWakeLock = true;
      if (requestPending || wakeLockRef.current) return;
      requestPending = true;
      try {
        if ('wakeLock' in navigator) {
          const sentinel = await navigator.wakeLock.request('screen');
          if (cancelled || !shouldHoldWakeLock) {
            await sentinel.release();
            return;
          }
          wakeLockRef.current = sentinel;

          sentinel.addEventListener('release', () => {
            if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
          });

          console.log('Wake lock acquired');
        }
      } catch (err) {
        console.info('Failed to acquire wake lock:', err);
      } finally {
        requestPending = false;
      }
    };

    const releaseWakeLock = () => {
      shouldHoldWakeLock = false;
      const sentinel = wakeLockRef.current;
      if (sentinel) {
        wakeLockRef.current = null;
        void sentinel.release().catch((err) => console.info('Failed to release wake lock:', err));
        console.log('Wake lock released');
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseWakeLock();
      } else {
        requestWakeLock();
      }
    };

    if (lock) {
      requestWakeLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else if (wakeLockRef.current) {
      releaseWakeLock();
    }

    return () => {
      cancelled = true;
      releaseWakeLock();
      if (lock) document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [lock]);
};
