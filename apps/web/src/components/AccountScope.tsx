'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { claimLocalLibrary } from '@/libs/localOwner';

// Holds the app back until the browser's library has been matched to the
// signed-in account, so nothing syncs the previous account's books into the new
// one. Signed-out pages (the sign-in routes) are not held.
const AccountScope = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { appService } = useEnv();
  const [claimedFor, setClaimedFor] = useState<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || !appService) return;
    let cancelled = false;
    claimLocalLibrary(appService, userId)
      .catch((error) => console.error('Could not match the local library to the account', error))
      .finally(() => {
        if (!cancelled) setClaimedFor(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, appService]);

  if (userId && claimedFor !== userId) return null;
  return <>{children}</>;
};

export default AccountScope;
