'use client';

import { useMemo, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import { useTranslation } from '@/hooks/useTranslation';
import {
  type Card,
  type CardGroup,
  type StudyMode,
  answerCard,
  groupStats,
  isLearnable,
  selectForStudy,
} from '@/libs/erinnern/cards';
import { bookSourceHref } from '@/libs/erinnern/quotes';
import { GRADES, formatInterval, previewIntervals } from '@/libs/erinnern/srs';

interface Props {
  userId: string;
  cards: Card[];
  groups: CardGroup[];
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
  onManage: () => void;
}

const SourceLinks = ({ card }: { card: Card }) => {
  const _ = useTranslation();
  if (card.card_sources.length === 0) return null;
  return (
    <ul className='mt-3 space-y-1 text-xs opacity-80'>
      {card.card_sources.map((source) => {
        const label =
          [source.title, source.author].filter(Boolean).join(' · ') || _('Unknown source');
        let href: string | null = null;
        if (source.kind === 'book') href = bookSourceHref(source);
        else if (source.kind === 'later' && source.later_item_id) {
          href = `/later/read?id=${encodeURIComponent(source.later_item_id)}`;
        } else if (source.url && /^https?:\/\//i.test(source.url)) href = source.url;
        return (
          <li key={source.id}>
            {href ? (
              <a href={href} className='link link-hover' target='_blank' rel='noreferrer'>
                {label}
              </a>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ul>
  );
};

const StudySession = ({ userId, cards, groups, onChanged, onError, onManage }: Props) => {
  const _ = useTranslation();
  const [mode, setMode] = useState<StudyMode>('due');
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const stats = useMemo(() => groupStats(cards, groups), [cards, groups]);
  const incomplete = cards.filter((c) => !isLearnable(c)).length;
  const current = queue?.[index] ?? null;
  const intervals = useMemo(() => (current ? previewIntervals(current) : null), [current]);

  const start = (groupId: string | null) => {
    setQueue(selectForStudy(cards, { groupId, mode }));
    setIndex(0);
    setDone(0);
    setRevealed(false);
  };

  const answer = async (grade: Grade) => {
    if (!current) return;
    setBusy(true);
    try {
      await answerCard(userId, current, grade);
      setDone((n) => n + 1);
      setIndex((i) => i + 1);
      setRevealed(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setQueue(null);
    await onChanged();
  };

  if (queue === null) {
    return (
      <div className='space-y-4'>
        <label className='form-control max-w-xs'>
          <span className='mb-1 text-sm opacity-70'>{_('Order')}</span>
          <select
            className='select select-bordered select-sm'
            value={mode}
            onChange={(e) => setMode(e.target.value as StudyMode)}
          >
            <option value='due'>{_('Due and new cards')}</option>
            <option value='random'>{_('Random')}</option>
          </select>
        </label>

        <div className='overflow-x-auto'>
          <table className='table table-sm'>
            <thead>
              <tr>
                <th>{_('Group')}</th>
                <th className='text-end text-success'>{_('Due')}</th>
                <th className='text-end text-info'>{_('New')}</th>
                <th className='text-end'>{_('Total')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => {
                const nothing = mode === 'due' && row.due + row.fresh === 0;
                return (
                  <tr key={row.id ?? 'all'} className={row.kind === 'all' ? 'font-semibold' : ''}>
                    <td>
                      {row.kind === 'all'
                        ? _('All cards')
                        : row.kind === 'book'
                          ? `📖 ${row.name}`
                          : row.name}
                    </td>
                    <td className='text-end'>{row.due}</td>
                    <td className='text-end'>{row.fresh}</td>
                    <td className='text-end'>{row.total}</td>
                    <td className='text-end'>
                      <button
                        type='button'
                        className='btn btn-primary btn-xs'
                        disabled={nothing || row.total === 0}
                        onClick={() => start(row.id)}
                      >
                        {_('Start')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {incomplete > 0 && (
          <p className='text-sm opacity-80'>
            {_('{{count}} cards still need an answer.', { count: incomplete })}{' '}
            <button type='button' className='link' onClick={onManage}>
              {_('Edit cards')}
            </button>
          </p>
        )}
      </div>
    );
  }

  if (!current) {
    return (
      <div className='space-y-4 py-8 text-center'>
        <p className='text-lg'>
          {queue.length === 0
            ? _('Nothing to learn here.')
            : _('Done! {{count}} cards answered.', { count: done })}
        </p>
        <button type='button' className='btn btn-neutral btn-sm' onClick={() => void finish()}>
          {_('Back')}
        </button>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between text-xs opacity-70'>
        <span>
          {index + 1} / {queue.length}
        </span>
        <button type='button' className='link' onClick={() => void finish()}>
          {_('Stop')}
        </button>
      </div>

      <article className='border-base-300 bg-base-200/40 rounded-lg border p-5'>
        <p className='whitespace-pre-line'>{current.front}</p>
        {revealed && (
          <>
            <hr className='border-base-300 my-4' />
            <p className='whitespace-pre-line'>{current.back}</p>
            <SourceLinks card={current} />
          </>
        )}
      </article>

      {revealed ? (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
          {GRADES.map(({ grade, key }) => (
            <button
              key={key}
              type='button'
              disabled={busy}
              onClick={() => void answer(grade)}
              className='btn btn-neutral btn-sm h-auto flex-col py-2'
            >
              <span>
                {{ again: _('Again'), hard: _('Hard'), good: _('Good'), easy: _('Easy') }[key]}
              </span>
              <span className='text-xs font-normal opacity-70'>
                {intervals ? formatInterval(intervals[grade]) : ''}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button type='button' className='btn btn-primary w-full' onClick={() => setRevealed(true)}>
          {_('Show answer')}
        </button>
      )}
    </div>
  );
};

export default StudySession;
