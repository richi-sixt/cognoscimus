import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { countOpenBookRequests } from '@/libs/libraryExplore';
import { countFollowRequests } from '@/libs/later/social';

/**
 * How many things wait for an answer on the People page: follow requests, articles
 * sent to the user and borrow requests. Read on mount and when the window regains
 * focus; a failed read counts as none, since this is only a hint.
 */
export const useOpenRequests = (): number => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return setCount(0);
    try {
      const [social, borrow] = await Promise.all([
        countFollowRequests(user.id),
        countOpenBookRequests(user.id),
      ]);
      setCount(social + borrow);
    } catch {
      setCount(0);
    }
  }, [user]);

  useEffect(() => {
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  return count;
};
