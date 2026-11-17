'use client';

import clsx from 'clsx';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { IoAdd } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  QUOTE_NOTE_MAX,
  QUOTE_TEXT_MAX,
  listDuplicatePairs,
  listQuotes,
  mergeInto,
  mergeQuotes,
  saveQuote,
  type Quote,
  type QuoteDuplicatePair,
  type SimilarQuote,
} from '@/libs/erinnern/quotes';
import ErinnernShell from './components/ErinnernShell';
import QuoteCard from './components/QuoteCard';

type View = 'all' | 'duplicates';

const ErinnernPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [pairs, setPairs] = useState<QuoteDuplicatePair[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('all');
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<SimilarQuote[] | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Ferinnern');
  }, [mounted, user]);

  const load = useCallback(async () => {
    try {
      setQuotes(await listQuotes(search));
      setPairs(await listDuplicatePairs());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : _('Something went wrong'));
    }
  }, [search, _]);

  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [user, load]);

  const byId = useMemo(() => new Map((quotes ?? []).map((q) => [q.id, q])), [quotes]);

  const resetForm = () => {
    setText('');
    setNote('');
    setTitle('');
    setAuthor('');
    setSimilar(null);
    setAdding(false);
  };

  const manualSource = () => ({ kind: 'manual' as const, title, author });

  const submit = async (event: FormEvent, force = false) => {
    event.preventDefault();
    if (!user || !text.trim()) return;
    setBusy(true);
    try {
      const result = await saveQuote(user.id, { text, note, source: manualSource() }, { force });
      if (result.status === 'similar') {
        setSimilar(result.candidates);
        return;
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const mergeIntoCandidate = async (quoteId: string) => {
    if (!user) return;
    setBusy(true);
    try {
      await mergeInto(user.id, quoteId, manualSource());
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const mergePair = async (keep: Quote, drop: Quote) => {
    if (!user) return;
    try {
      await mergeQuotes(user.id, keep, drop);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : _('Something went wrong'));
    }
  };

  const visiblePairs = pairs.filter((p) => byId.has(p.a_id) && byId.has(p.b_id));

  return (
    <ErinnernShell active='quotes'>
      <div className='mb-4 flex flex-wrap items-center gap-2'>
        <input
          type='search'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={_('Search text, author or source')}
          aria-label={_('Search quotes')}
          className='input input-bordered input-sm min-w-0 flex-1'
        />
        <div className='join'>
          {(['all', 'duplicates'] as View[]).map((v) => (
            <button
              key={v}
              type='button'
              onClick={() => setView(v)}
              className={clsx('btn btn-sm join-item', view === v && 'btn-neutral')}
            >
              {v === 'all'
                ? _('All')
                : `${_('Possible duplicates')}${visiblePairs.length ? ` (${visiblePairs.length})` : ''}`}
            </button>
          ))}
        </div>
        <button type='button' className='btn btn-sm btn-primary' onClick={() => setAdding(true)}>
          <IoAdd className='h-4 w-4' />
          {_('Add quote')}
        </button>
      </div>

      {error && (
        <div role='alert' className='alert alert-error mb-4 text-sm'>
          {error}
        </div>
      )}

      {adding && (
        <form
          onSubmit={(e) => void submit(e)}
          className='border-base-300 bg-base-200/50 mb-6 space-y-2 rounded-lg border p-3'
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={QUOTE_TEXT_MAX}
            rows={4}
            required
            autoFocus
            placeholder={_('The quote')}
            aria-label={_('The quote')}
            className='textarea textarea-bordered w-full'
          />
          <div className='grid gap-2 sm:grid-cols-2'>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              placeholder={_('Source (book, article, ...)')}
              aria-label={_('Source')}
              className='input input-bordered input-sm'
            />
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              maxLength={500}
              placeholder={_('Author')}
              aria-label={_('Author')}
              className='input input-bordered input-sm'
            />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={QUOTE_NOTE_MAX}
            rows={2}
            placeholder={_('Your own thoughts (optional)')}
            aria-label={_('Your own thoughts')}
            className='textarea textarea-bordered w-full'
          />

          {similar && (
            <div className='alert alert-warning block space-y-2 text-sm'>
              <p>{_('A similar quote already exists:')}</p>
              {similar.map((s) => (
                <div key={s.id} className='bg-base-100 rounded p-2'>
                  <p className='line-clamp-3'>{s.text}</p>
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => void mergeIntoCandidate(s.id)}
                    className='btn btn-xs btn-neutral mt-2'
                  >
                    {_('Add my source to this one')}
                  </button>
                </div>
              ))}
              <button
                type='button'
                disabled={busy}
                onClick={(e) => void submit(e, true)}
                className='btn btn-xs'
              >
                {_('Save as a new quote anyway')}
              </button>
            </div>
          )}

          <div className='flex justify-end gap-2'>
            <button type='button' className='btn btn-ghost btn-sm' onClick={resetForm}>
              {_('Cancel')}
            </button>
            <button
              type='submit'
              disabled={busy || !text.trim()}
              className='btn btn-primary btn-sm'
            >
              {_('Save')}
            </button>
          </div>
        </form>
      )}

      {quotes === null && !error && <p className='text-sm opacity-70'>{_('Loading...')}</p>}

      {view === 'all' && quotes && (
        <>
          {quotes.length === 0 && (
            <p className='py-12 text-center text-sm opacity-70'>
              {search
                ? _('No quotes found.')
                : _('No quotes yet. Select a passage in a book or an article, or add one here.')}
            </p>
          )}
          <ul className='space-y-3'>
            {quotes.map((quote) => (
              <li key={quote.id}>
                <QuoteCard quote={quote} onChanged={load} onError={setError} />
              </li>
            ))}
          </ul>
        </>
      )}

      {view === 'duplicates' && quotes && (
        <>
          {visiblePairs.length === 0 && (
            <p className='py-12 text-center text-sm opacity-70'>{_('No possible duplicates.')}</p>
          )}
          <ul className='space-y-6'>
            {visiblePairs.map((pair) => {
              const a = byId.get(pair.a_id)!;
              const b = byId.get(pair.b_id)!;
              return (
                <li key={`${pair.a_id}-${pair.b_id}`} className='space-y-2'>
                  <p className='text-xs opacity-70'>
                    {_('Similarity')}: {Math.round(pair.similarity * 100)}%
                  </p>
                  <QuoteCard quote={a} onChanged={load} onError={setError} />
                  <QuoteCard quote={b} onChanged={load} onError={setError} />
                  <div className='flex justify-end gap-2'>
                    <button
                      type='button'
                      className='btn btn-xs'
                      onClick={() => void mergePair(a, b)}
                    >
                      {_('Merge into the first')}
                    </button>
                    <button
                      type='button'
                      className='btn btn-xs'
                      onClick={() => void mergePair(b, a)}
                    >
                      {_('Merge into the second')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ErinnernShell>
  );
};

export default ErinnernPage;
