'use client';

import DOMPurify from 'dompurify';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { getSharedArticle, type SharedArticle } from '@/libs/later/social';

// A shared article of someone you follow: title and text, nothing else.
const SharedReader = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();
  const id = useSearchParams()?.get('id') ?? '';

  const [article, setArticle] = useState<SharedArticle | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) window.location.assign('/auth?redirect=%2Flater%2Ffollowing');
  }, [user]);

  useEffect(() => {
    if (!id || !user) return;
    getSharedArticle(id)
      .then((found) => (found ? setArticle(found) : setMissing(true)))
      .catch((err) =>
        setError(err instanceof Error ? err.message : _('Could not load the article')),
      );
  }, [id, user, _]);

  const html = useMemo(
    () =>
      article ? DOMPurify.sanitize(article.content_html, { USE_PROFILES: { html: true } }) : '',
    [article],
  );

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <Link
          href='/later/following'
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Back')}
        >
          <IoArrowBack className='h-5 w-5' />
        </Link>
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
            <h1 className='mb-4 text-3xl leading-tight font-bold'>{article.title}</h1>
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
