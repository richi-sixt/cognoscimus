'use client';

import DOMPurify from 'dompurify';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { IoArrowBack, IoOpenOutline } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { isMailUrl } from '@/libs/later/constants';
import {
  answerShare,
  getIncomingShare,
  getSharedArticle,
  type SharedArticle,
  saveShared,
} from '@/libs/later/social';
import KindBadge from '../../components/KindBadge';

// A shared item (of someone you follow) or an offer sent to you, opened for reading.
// From here it can be saved to the library or left alone; the source stays one click away.
const SharedReader = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();
  const params = useSearchParams();
  const id = params?.get('id') ?? '';
  const offer = params?.get('offer') === '1';
  const back = offer ? '/people' : '/later/explore';

  const [article, setArticle] = useState<SharedArticle | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'new' | 'already' | null>(null);

  useEffect(() => {
    if (!user) window.location.assign(`/auth?redirect=${encodeURIComponent(back)}`);
  }, [user, back]);

  useEffect(() => {
    if (!id || !user) return;
    (offer ? getIncomingShare(id) : getSharedArticle(id))
      .then((found) => (found ? setArticle(found) : setMissing(true)))
      .catch((err) =>
        setError(err instanceof Error ? err.message : _('Could not load the article')),
      );
  }, [id, offer, user, _]);

  const html = useMemo(
    () =>
      article ? DOMPurify.sanitize(article.content_html, { USE_PROFILES: { html: true } }) : '',
    [article],
  );

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (offer) {
        // Saving an offer also closes it.
        await answerShare(id, true);
        window.location.assign('/people');
        return;
      }
      setSaved((await saveShared(id)) ? 'new' : 'already');
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await answerShare(id, false);
      window.location.assign('/people');
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
      setBusy(false);
    }
  };

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <a href={back} className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
          <IoArrowBack className='h-5 w-5' />
        </a>
        <span className='flex-1' />
        {article && (
          <>
            {!isMailUrl(article.url) && (
              <a
                href={article.url}
                target='_blank'
                rel='noopener noreferrer'
                className='btn btn-ghost btn-sm'
              >
                <IoOpenOutline className='h-4 w-4' />
                {_('Open source')}
              </a>
            )}
            {saved ? (
              <span className='text-sm'>
                {saved === 'new' ? _('Saved to your library.') : _('Already in your library.')}
              </span>
            ) : (
              <button
                type='button'
                className='btn btn-primary btn-sm'
                disabled={busy}
                onClick={save}
              >
                {_('Save')}
              </button>
            )}
            {offer && (
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                disabled={busy}
                onClick={decline}
              >
                {_('Delete')}
              </button>
            )}
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
        {!article && !missing && !error && <span className='loading loading-dots loading-md' />}
        {article && (
          <article>
            <p className='mb-2 flex items-center gap-2 text-sm'>
              <KindBadge kind={article.kind} />
              <span className='text-base-content/60'>
                {[
                  _('from @{{handle}}', { handle: article.from_handle }),
                  article.author,
                  article.site_name,
                  new Date(article.saved_at).toLocaleDateString(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
            <h1 className='mb-4 text-3xl leading-tight font-bold'>{article.title}</h1>
            {article.note && (
              <p className='bg-base-200 mb-4 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap'>
                {article.note}
              </p>
            )}
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

const Page = () => (
  <Suspense>
    <SharedReader />
  </Suspense>
);

export default Page;
