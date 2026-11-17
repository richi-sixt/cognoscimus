'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { type Card, type CardGroup, listCards, listGroups } from '@/libs/erinnern/cards';
import CardsManager from '../components/CardsManager';
import ErinnernShell from '../components/ErinnernShell';
import StudySession from '../components/StudySession';

type Part = 'study' | 'cards';

const LearnPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [groups, setGroups] = useState<CardGroup[]>([]);
  const [part, setPart] = useState<Part>('study');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Ferinnern%2Flernen');
  }, [mounted, user]);

  const load = useCallback(async () => {
    try {
      const [loadedCards, loadedGroups] = await Promise.all([listCards(), listGroups()]);
      setCards(loadedCards);
      setGroups(loadedGroups);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : _('Something went wrong'));
    }
  }, [_]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  return (
    <ErinnernShell active='learn'>
      <div className='join mb-4'>
        {(['study', 'cards'] as Part[]).map((p) => (
          <button
            key={p}
            type='button'
            onClick={() => setPart(p)}
            className={clsx('btn btn-sm join-item', part === p && 'btn-neutral')}
          >
            {p === 'study' ? _('Study') : _('Cards')}
          </button>
        ))}
      </div>

      {error && (
        <div role='alert' className='alert alert-error mb-4 text-sm'>
          {error}
        </div>
      )}
      {cards === null && !error && <p className='text-sm opacity-70'>{_('Loading...')}</p>}

      {cards && user && part === 'study' && (
        <StudySession
          userId={user.id}
          cards={cards}
          groups={groups}
          onChanged={load}
          onError={setError}
          onManage={() => setPart('cards')}
        />
      )}
      {cards && user && part === 'cards' && (
        <CardsManager
          userId={user.id}
          cards={cards}
          groups={groups}
          onChanged={load}
          onError={setError}
        />
      )}
    </ErinnernShell>
  );
};

export default LearnPage;
