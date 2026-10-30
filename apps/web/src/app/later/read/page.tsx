'use client';

import DOMPurify from 'dompurify';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { IoArchiveOutline, IoArrowBack, IoOpenOutline, IoTrashOutline } from 'react-icons/io5';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createLabel,
  deleteItem,
  getItem,
  listItemLabelIds,
  listLabels,
  setItemLabel,
  setItemProgress,
  setItemState,
  type LaterItemFull,
  type LaterLabel,
} from '@/libs/later/client';

const Reader = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const id = useSearchParams()?.get('id');
  useTheme();

  const [item, setItem] = useState<LaterItemFull | null>(null);
  const [missing, setMissing] = useState(false);
  const [labels, setLabels] = useState<LaterLabel[]>([]);
  const [itemLabelIds, setItemLabelIds] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<LaterItemFull['state']>('unread');
  const restored = useRef(false);

  useEffect(() => {
    if (!user) window.location.assign('/auth?redirect=%2Flater');
  }, [user]);

  useEffect(() => {
    if (!id || !user) return;
    void (async () => {
      try {
        const found = await getItem(id);
        if (!found) return setMissing(true);
        stateRef.current = found.state;
        setItem(found);
        setLabels(await listLabels());
        setItemLabelIds(await listItemLabelIds(id));
      } catch (err) {
        setError(err instanceof Error ? err.message : _('Could not load the article'));
      }
    })();
  }, [id, user, _]);

  // The stored HTML is already sanitised on the server; this is a second pass.
  const html = useMemo(
    () => (item ? DOMPurify.sanitize(item.content_html, { USE_PROFILES: { html: true } }) : ''),
    [item],
  );

  // Restore the saved position once, after the article is in the DOM.
  useEffect(() => {
    if (!item || restored.current) return;
    restored.current = true;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (item.progress > 0 && item.state !== 'archived' && max > 0) {
      window.scrollTo({ top: item.progress * max });
    }
  }, [item]);

  // Save the reading position, debounced; the first scroll marks it "reading".
  useEffect(() => {
    if (!item) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max <= 0) return;
        const state = stateRef.current === 'unread' ? 'reading' : stateRef.current;
        stateRef.current = state;
        void setItemProgress(item.id, window.scrollY / max, state).catch(() => undefined);
      }, 800);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [item]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : _('Something went wrong'));
      }
    },
    [_],
  );

  const toggleArchive = () =>
    run(async () => {
      if (!item) return;
      const next = item.state === 'archived' ? 'unread' : 'archived';
      await setItemState(item.id, next);
      stateRef.current = next;
      setItem({ ...item, state: next });
    });

  const remove = () =>
    run(async () => {
      if (!item || !window.confirm(_('Delete this article?'))) return;
      await deleteItem(item.id);
      router.push('/later');
    });

  const toggleLabel = (labelId: string) =>
    run(async () => {
      if (!item) return;
      const on = !itemLabelIds.includes(labelId);
      await setItemLabel(item.id, labelId, on);
      setItemLabelIds(on ? [...itemLabelIds, labelId] : itemLabelIds.filter((l) => l !== labelId));
      // A label nobody carries any more is deleted by the database.
      if (!on) setLabels(await listLabels());
    });

  const addLabel = () =>
    run(async () => {
      const name = newLabel.trim();
      if (!item || !user || !name) return;
      const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      const label = existing ?? (await createLabel(user.id, name));
      if (!existing) setLabels([...labels, label].sort((a, b) => a.name.localeCompare(b.name)));
      if (!itemLabelIds.includes(label.id)) {
        await setItemLabel(item.id, label.id, true);
        setItemLabelIds([...itemLabelIds, label.id]);
      }
      setNewLabel('');
    });

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='bg-base-100/90 sticky top-0 z-10 flex items-center gap-1 px-4 py-3 backdrop-blur'>
        <button
          type='button'
          onClick={() => router.push('/later')}
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Back')}
        >
          <IoArrowBack className='h-5 w-5' />
        </button>
        <div className='flex-1' />
        {item && (
          <>
            <a
              href={item.url}
              target='_blank'
              rel='noopener noreferrer'
              className='btn btn-ghost btn-circle btn-sm'
              aria-label={_('Open original')}
            >
              <IoOpenOutline className='h-5 w-5' />
            </a>
            <button
              type='button'
              onClick={toggleArchive}
              className='btn btn-ghost btn-circle btn-sm'
              aria-label={item.state === 'archived' ? _('Move to inbox') : _('Archive')}
            >
              <IoArchiveOutline className='h-5 w-5' />
            </button>
            <button
              type='button'
              onClick={remove}
              className='btn btn-ghost btn-circle btn-sm'
              aria-label={_('Delete')}
            >
              <IoTrashOutline className='h-5 w-5' />
            </button>
          </>
        )}
      </header>

      <main className='mx-auto max-w-2xl px-4 pb-16'>
        {error && (
          <p className='text-error mb-4 text-sm' role='alert'>
            {error}
          </p>
        )}
        {missing && <p className='text-base-content/60'>{_('This article was not found.')}</p>}
        {!item && !missing && !error && <span className='loading loading-dots loading-md' />}
        {item && (
          <article>
            <h1 className='mb-2 text-3xl leading-tight font-bold'>{item.title}</h1>
            <p className='text-base-content/60 mb-4 text-sm'>
              {[item.author, item.site_name, new Date(item.saved_at).toLocaleDateString()]
                .filter(Boolean)
                .join(' · ')}
            </p>

            <div className='mb-6 flex flex-wrap items-center gap-2'>
              {labels.map((label) => (
                <button
                  key={label.id}
                  type='button'
                  onClick={() => toggleLabel(label.id)}
                  className={clsx(
                    'badge badge-lg',
                    itemLabelIds.includes(label.id) ? 'badge-primary' : 'badge-outline',
                  )}
                >
                  {label.name}
                </button>
              ))}
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addLabel()}
                maxLength={40}
                placeholder={_('New label')}
                aria-label={_('New label')}
                className='input input-bordered input-xs w-28'
              />
            </div>

            <div
              className='prose prose-lg max-w-none break-words [&_img]:h-auto [&_img]:max-w-full'
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        )}
      </main>
    </div>
  );
};

const ReadPage = () => (
  <Suspense fallback={null}>
    <Reader />
  </Suspense>
);

export default ReadPage;
