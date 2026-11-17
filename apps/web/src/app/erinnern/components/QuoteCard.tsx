'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { cardFromQuote } from '@/libs/erinnern/cards';
import { useTranslation } from '@/hooks/useTranslation';
import {
  QUOTE_NOTE_MAX,
  QUOTE_TEXT_MAX,
  bookSourceHref,
  deleteQuote,
  deleteSource,
  sourceLabel,
  updateQuote,
  type Quote,
  type QuoteSource,
} from '@/libs/erinnern/quotes';

interface Props {
  quote: Quote;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}

// A source links back to where the quote came from: the book at the quoted
// place, or the saved article. A deleted book or article leaves plain text.
const SourceLine = ({ source }: { source: QuoteSource }) => {
  const _ = useTranslation();
  const label = sourceLabel(source) || _('Unknown source');
  let href: string | null = null;
  if (source.kind === 'book') href = bookSourceHref(source);
  else if (source.kind === 'later' && source.later_item_id) {
    href = `/later/read?id=${encodeURIComponent(source.later_item_id)}`;
  } else if (source.url && /^https?:\/\//i.test(source.url)) href = source.url;

  return href ? (
    <a href={href} className='link link-hover' title={_('Open the source')}>
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
};

const QuoteCard = ({ quote, onChanged, onError }: Props) => {
  const _ = useTranslation();
  const { user } = useAuth();
  const [learnNotice, setLearnNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(quote.text);
  const [note, setNote] = useState(quote.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : _('Something went wrong'));
    }
  };

  const makeCard = () =>
    run(async () => {
      if (!user) return;
      const result = await cardFromQuote(user.id, quote);
      setLearnNotice(
        result.status === 'created' ? _('Added to Learn') : _('This quote is already a card'),
      );
    });

  const save = () =>
    run(async () => {
      await updateQuote(quote.id, { text, note });
      setEditing(false);
    });

  return (
    <article className='border-base-300 bg-base-200/40 rounded-lg border p-4'>
      {editing ? (
        <div className='space-y-2'>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={QUOTE_TEXT_MAX}
            rows={4}
            aria-label={_('The quote')}
            className='textarea textarea-bordered w-full'
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={QUOTE_NOTE_MAX}
            rows={2}
            placeholder={_('Your own thoughts (optional)')}
            aria-label={_('Your own thoughts')}
            className='textarea textarea-bordered w-full'
          />
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={() => setEditing(false)}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-primary btn-xs'
              disabled={!text.trim()}
              onClick={() => void save()}
            >
              {_('Save')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <blockquote className='border-primary/40 border-s-4 ps-3 whitespace-pre-line'>
            {quote.text}
          </blockquote>
          {quote.note && <p className='mt-2 text-sm opacity-80'>{quote.note}</p>}
        </>
      )}

      {quote.quote_sources.length > 0 && (
        <ul className='mt-3 space-y-1 text-xs opacity-80'>
          {quote.quote_sources.map((source) => (
            <li key={source.id} className='flex items-center gap-2'>
              <SourceLine source={source} />
              {editing && quote.quote_sources.length > 1 && (
                <button
                  type='button'
                  className='btn btn-ghost btn-xs'
                  onClick={() => void run(() => deleteSource(source.id))}
                  aria-label={_('Remove this source')}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!editing && (
        <div className='mt-3 flex items-center justify-end gap-1'>
          {learnNotice && <span className='me-auto text-xs opacity-70'>{learnNotice}</span>}
          <button type='button' className='btn btn-ghost btn-xs' onClick={() => void makeCard()}>
            {_('Learn')}
          </button>
          <button type='button' className='btn btn-ghost btn-xs' onClick={() => setEditing(true)}>
            {_('Edit')}
          </button>
          {confirmDelete ? (
            <>
              <button
                type='button'
                className='btn btn-error btn-xs'
                onClick={() => void run(() => deleteQuote(quote.id))}
              >
                {_('Delete quote')}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => setConfirmDelete(false)}
              >
                {_('Cancel')}
              </button>
            </>
          ) : (
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={() => setConfirmDelete(true)}
            >
              {_('Delete')}
            </button>
          )}
        </div>
      )}
    </article>
  );
};

export default QuoteCard;
