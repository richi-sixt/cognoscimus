'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  type BookRequest,
  ExploreApiError,
  getSharedCovers,
  type LibraryOwner,
  listBookRequests,
  listLibraryOwners,
  listSharedBooks,
  requestBook,
  type SharedBook,
} from '@/libs/libraryExplore';
import { EXPLORE_PAGE_SIZE } from '@/services/constants';

const nameOf = (p: { display_name: string; handle: string }) =>
  p.display_name ? `${p.display_name} (@${p.handle})` : `@${p.handle}`;

// Books of the people I follow, read one page at a time on the server. This page
// never touches my own library: nothing is synced, only title, author and cover
// of the visible page are loaded.
const ExplorePage = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [owners, setOwners] = useState<LibraryOwner[] | null>(null);
  const [owner, setOwner] = useState<LibraryOwner | null>(null);
  const [books, setBooks] = useState<SharedBook[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<BookRequest[]>([]);
  const [asking, setAsking] = useState<SharedBook | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow answer for an earlier person or search overwriting a newer one.
  const generation = useRef(0);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flibrary%2Fexplore');
  }, [mounted, user]);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof Error ? err.message : _('Something went wrong')),
    [_],
  );

  useEffect(() => {
    if (!user) return;
    void listLibraryOwners().then(setOwners).catch(fail);
    void listBookRequests('requester')
      .then(setSent)
      .catch(() => setSent([]));
  }, [user, fail]);

  const loadPage = useCallback(
    async (who: LibraryOwner, search: string, after: SharedBook | null) => {
      const current = ++generation.current;
      setLoading(true);
      try {
        const page = await listSharedBooks(who.user_id, { query: search, after });
        if (current !== generation.current) return;
        setBooks((previous) => (after ? [...previous, ...page] : page));
        setMore(page.length === EXPLORE_PAGE_SIZE);
        setError(null);
        // Covers are signed per page; a missing cover just shows the title.
        const urls = await getSharedCovers(
          who.user_id,
          page.filter((b) => b.cover_hash).map((b) => b.book_hash),
        ).catch(() => ({}) as Record<string, string>);
        if (current === generation.current) setCovers((previous) => ({ ...previous, ...urls }));
      } catch (err) {
        if (current === generation.current) fail(err);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [fail],
  );

  const open = (who: LibraryOwner) => {
    setOwner(who);
    setBooks([]);
    setCovers({});
    setQuery('');
    setNotice(null);
    void loadPage(who, '', null);
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    setBooks([]);
    void loadPage(owner, query, null);
  };

  const statusOf = (book: SharedBook) =>
    sent.find((r) => r.owner_id === owner?.user_id && r.book_hash === book.book_hash)?.status;

  // A file is borrowed once and then sits under "Shared with me". A printed
  // book can be asked for again after an earlier loan came back.
  const mayRequest = (book: SharedBook) => {
    const status = statusOf(book);
    if (book.is_physical) return !book.lent && (!status || status === 'accepted');
    return book.has_file && !status;
  };

  const ask = async () => {
    if (!owner || !asking || busy) return;
    setBusy(true);
    try {
      await requestBook({ ownerId: owner.user_id, bookHash: asking.book_hash, message });
      setNotice(_('Request sent. {{name}} decides whether to lend it.', { name: nameOf(owner) }));
      setAsking(null);
      setMessage('');
      setSent(await listBookRequests('requester'));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ExploreApiError && err.code === 'declined_recently'
          ? _('This request was declined recently. You can ask again later.')
          : err instanceof Error
            ? err.message
            : _('Something went wrong'),
      );
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (status: BookRequest['status'] | undefined) =>
    status === 'pending'
      ? _('Requested')
      : status === 'accepted'
        ? _('Lent to you')
        : status === 'declined'
          ? _('Declined')
          : null;

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Back')}
          onClick={() => (owner ? setOwner(null) : router.push('/library'))}
        >
          <IoArrowBack className='h-5 w-5' />
        </button>
        <h1 className='text-lg font-semibold'>{owner ? nameOf(owner) : _('Explore')}</h1>
      </header>

      <main className='mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-16'>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
        {notice && <p className='text-success text-sm'>{notice}</p>}

        {!owner && owners === null && <span className='loading loading-dots loading-md' />}

        {!owner && owners?.length === 0 && (
          <div className='bg-base-200/60 flex flex-col gap-2 rounded-2xl p-4 text-sm'>
            <p>{_('No one you follow shares a library yet.')}</p>
            <p className='text-base-content/70'>
              {_('Follow people and ask them to switch on library sharing in their profile.')}
            </p>
            <a href='/people?from=library' className='btn btn-primary btn-sm w-fit'>
              {_('People')}
            </a>
          </div>
        )}

        {!owner && owners && owners.length > 0 && (
          <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
            {owners.map((p) => (
              <li key={p.user_id}>
                <button
                  type='button'
                  className='hover:bg-base-300/50 flex w-full items-center justify-between gap-3 px-4 py-3 text-left'
                  onClick={() => open(p)}
                >
                  <span className='min-w-0 truncate'>{nameOf(p)}</span>
                  <span className='text-base-content/60 shrink-0 text-xs'>
                    {_('{{count}} books', { count: p.shared_count })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {owner && (
          <>
            <form onSubmit={search} className='join w-full'>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={_('Search title or author')}
                aria-label={_('Search title or author')}
                className='input input-bordered input-sm join-item w-full'
              />
              <button type='submit' className='btn btn-sm join-item'>
                {_('Search')}
              </button>
            </form>

            {!loading && books.length === 0 && (
              <p className='text-base-content/60 text-sm'>{_('No books found.')}</p>
            )}

            <ul className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4'>
              {books.map((book) => {
                // "Lent to you" holds for a printed book only while it is out.
                const label =
                  book.is_physical && !book.lent && statusOf(book) === 'accepted'
                    ? null
                    : statusLabel(statusOf(book));
                return (
                  <li key={book.book_hash}>
                    <button
                      type='button'
                      className='flex w-full flex-col gap-1 text-left'
                      onClick={() => {
                        setNotice(null);
                        setAsking(book);
                      }}
                    >
                      <span className='bg-base-200 relative flex aspect-[28/41] w-full items-center justify-center overflow-hidden rounded-lg'>
                        {covers[book.book_hash] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={covers[book.book_hash]}
                            alt=''
                            loading='lazy'
                            crossOrigin='anonymous'
                            className='h-full w-full object-cover'
                          />
                        ) : (
                          <span className='text-base-content/50 line-clamp-4 px-2 text-center text-xs'>
                            {book.title}
                          </span>
                        )}
                        {label && (
                          <span className='badge badge-neutral badge-sm absolute bottom-1 left-1'>
                            {label}
                          </span>
                        )}
                        {book.is_physical && (
                          <span className='badge badge-ghost badge-sm absolute right-1 top-1'>
                            {book.lent ? _('Lent') : _('Printed')}
                          </span>
                        )}
                      </span>
                      <span className='line-clamp-2 text-sm font-medium'>{book.title}</span>
                      {book.author && (
                        <span className='text-base-content/60 line-clamp-1 text-xs'>
                          {book.author}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {loading && <span className='loading loading-dots loading-md self-center' />}
            {more && !loading && (
              <button
                type='button'
                className='btn btn-ghost btn-sm self-center'
                onClick={() => void loadPage(owner, query, books[books.length - 1] ?? null)}
              >
                {_('Load more')}
              </button>
            )}
          </>
        )}
      </main>

      {asking && owner && (
        <div className='modal modal-open' role='dialog' aria-modal='true'>
          <div className='modal-box flex flex-col gap-3'>
            <h2 className='font-semibold'>{asking.title}</h2>
            {asking.author && <p className='text-base-content/70 text-sm'>{asking.author}</p>}
            {asking.is_physical && (
              <p className='text-base-content/70 text-xs'>
                {_('A printed book. It changes hands in person.')}
              </p>
            )}
            {statusOf(asking) === 'pending' ? (
              <p className='text-sm'>{_('You already asked for this book.')}</p>
            ) : asking.is_physical && asking.lent ? (
              <p className='text-sm'>
                {statusOf(asking) === 'accepted'
                  ? _('It is lent to you.')
                  : _('This book is lent to someone right now.')}
              </p>
            ) : !asking.is_physical && !asking.has_file ? (
              <p className='text-sm'>{_('This book is not available for borrowing.')}</p>
            ) : !asking.is_physical && statusOf(asking) === 'accepted' ? (
              <p className='text-sm'>
                {_('It was lent to you.')}{' '}
                <a href='/shared' className='link'>
                  {_('Shared with me')}
                </a>
              </p>
            ) : (
              <>
                <p className='text-sm'>
                  {asking.is_physical
                    ? _('Ask {{name}} to lend you the printed book.', { name: nameOf(owner) })
                    : _('Ask {{name}} to lend you this book for a limited time.', {
                        name: nameOf(owner),
                      })}
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 300))}
                  placeholder={_('Message (optional)')}
                  aria-label={_('Message (optional)')}
                  rows={3}
                  className='textarea textarea-bordered w-full text-sm'
                />
              </>
            )}
            <div className='modal-action'>
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => setAsking(null)}
              >
                {_('Close')}
              </button>
              {mayRequest(asking) && (
                <button
                  type='button'
                  className='btn btn-primary btn-sm'
                  disabled={busy}
                  onClick={() => void ask()}
                >
                  {_('Ask to borrow')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExplorePage;
