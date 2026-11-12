'use client';

import { useEffect, useRef, useState } from 'react';
import { MdOutlineQrCodeScanner, MdSearch } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { Book } from '@/types/book';
import type { BookCandidate } from '@/libs/bookLookup';
import { bookFromUrl, fetchCover, searchBooks } from '@/libs/bookLookupClient';
import {
  newPhysicalBook,
  normalizeIsbn,
  PHYSICAL_LOCATION_MAX,
  PHYSICAL_TEXT_MAX,
} from '@/utils/physicalBook';

interface AddPhysicalBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Puts the entry on the shelf; the cover, when there is one, is a blob URL. */
  onAdd: (book: Book, coverBlobUrl?: string) => Promise<void>;
}

interface Detection {
  rawValue: string;
}
interface Detector {
  detect: (source: HTMLVideoElement) => Promise<Detection[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

const detectorClass = (): DetectorClass | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

const emptyForm = {
  title: '',
  author: '',
  isbn: '',
  publisher: '',
  published: '',
  language: '',
  description: '',
};

/**
 * Adds a printed book to the library: found by ISBN or title, scanned from the
 * barcode, read from a bookshop page, or typed in. What a lookup finds only
 * fills the form; the entry is created from what the form says.
 */
const AddPhysicalBookDialog: React.FC<AddPhysicalBookDialogProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const _ = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookCandidate[] | null>(null);
  const [link, setLink] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [coverBlobUrl, setCoverBlobUrl] = useState<string | null>(null);
  const [owned, setOwned] = useState(true);
  const [location, setLocation] = useState('');
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Guards against a slow lookup landing in a dialog that was reopened.
  const openingRef = useRef(0);
  const canScan = !!detectorClass();

  useEffect(() => {
    if (!isOpen) return;
    openingRef.current += 1;
    setQuery('');
    setResults(null);
    setLink('');
    setForm(emptyForm);
    setCoverBlobUrl(null);
    setOwned(true);
    setLocation('');
    setLooking(false);
    setBusy(false);
    setScanning(false);
    setError(null);
  }, [isOpen]);

  const loadCover = async (url: string | undefined) => {
    if (!url) return;
    const opening = openingRef.current;
    try {
      const blob = await fetchCover(url);
      if (opening === openingRef.current) setCoverBlobUrl(URL.createObjectURL(blob));
    } catch {
      // A book without a cover is still a book; the user can add a photo.
    }
  };

  const applyCandidate = (candidate: BookCandidate) => {
    setForm({
      title: candidate.title,
      author: candidate.author ?? '',
      isbn: candidate.isbn ?? '',
      publisher: candidate.publisher ?? '',
      published: candidate.published ?? '',
      language: candidate.language ?? '',
      description: candidate.description ?? '',
    });
    setCoverBlobUrl(null);
    setResults(null);
    void loadCover(candidate.coverUrl);
  };

  const search = async (text: string = query) => {
    const wanted = text.trim();
    if (!wanted || looking) return;
    const opening = openingRef.current;
    setLooking(true);
    setError(null);
    try {
      const found = await searchBooks(wanted);
      if (opening !== openingRef.current) return;
      setResults(found);
      if (found.length === 0) {
        // Nothing found: keep what was typed, so the form is not empty.
        const isbn = normalizeIsbn(wanted);
        setForm((current) => (isbn ? { ...current, isbn } : { ...current, title: wanted }));
      }
    } catch (err) {
      if (opening === openingRef.current) {
        setError(err instanceof Error ? _(err.message) : _('Something went wrong'));
      }
    } finally {
      if (opening === openingRef.current) setLooking(false);
    }
  };

  const readLink = async () => {
    const wanted = link.trim();
    if (!wanted || looking) return;
    const opening = openingRef.current;
    setLooking(true);
    setError(null);
    try {
      const found = await bookFromUrl(wanted);
      if (opening !== openingRef.current) return;
      applyCandidate(found);
    } catch (err) {
      if (opening === openingRef.current) {
        setError(err instanceof Error ? _(err.message) : _('Something went wrong'));
      }
    } finally {
      if (opening === openingRef.current) setLooking(false);
    }
  };

  // The camera runs only while scanning; the first book barcode ends it.
  useEffect(() => {
    const Detector = detectorClass();
    if (!scanning || !Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) return stop();
        const video = videoRef.current;
        if (!video) return stop();
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ['ean_13'] });
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            const isbn = codes.map((c) => normalizeIsbn(c.rawValue)).find((c) => /^97[89]/.test(c));
            if (isbn && !stopped) {
              stop();
              setScanning(false);
              setQuery(isbn);
              void search(isbn);
            }
          } catch {
            // A frame that cannot be read is skipped.
          }
        }, 350);
      } catch {
        stop();
        setScanning(false);
        setError(_('The camera could not be opened. Type the ISBN instead.'));
      }
    };
    void start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const chooseImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file?.type.startsWith('image/')) setCoverBlobUrl(URL.createObjectURL(file));
  };

  const close = () => {
    if (!busy) onClose();
  };

  const add = async () => {
    if (busy || !form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const book = newPhysicalBook({ ...form, owned, location: owned ? location : '' });
      await onAdd(book, coverBlobUrl ?? undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? _(err.message) : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof typeof emptyForm,
    label: string,
    options: { max?: number; inputMode?: 'numeric' | 'text'; className?: string } = {},
  ) => (
    <label className={`flex flex-col gap-1 ${options.className ?? ''}`}>
      <span className='text-base-content/70 text-xs'>{label}</span>
      <input
        type='text'
        className='input input-sm eink-bordered w-full'
        value={form[key]}
        maxLength={options.max ?? PHYSICAL_TEXT_MAX}
        inputMode={options.inputMode}
        disabled={busy}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={_('Add a printed book')}
      aboveKeyboard
      boxClassName='sm:w-[560px]! sm:max-w-[560px]! sm:h-auto! sm:max-h-[90vh]!'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <form
          className='flex items-end gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label className='flex min-w-0 flex-1 flex-col gap-1'>
            <span className='text-base-content/70 text-xs'>{_('Find by ISBN or title')}</span>
            <input
              type='text'
              autoFocus
              className='input input-sm eink-bordered w-full'
              value={query}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type='submit'
            className='btn btn-sm eink-bordered'
            disabled={busy || looking || !query.trim()}
            aria-label={_('Search')}
          >
            <MdSearch aria-hidden='true' className='h-4 w-4' />
          </button>
          {canScan && (
            <button
              type='button'
              className='btn btn-sm eink-bordered'
              disabled={busy}
              aria-label={scanning ? _('Stop scanning') : _('Scan the barcode')}
              title={scanning ? _('Stop scanning') : _('Scan the barcode')}
              aria-pressed={scanning}
              onClick={() => setScanning((current) => !current)}
            >
              <MdOutlineQrCodeScanner aria-hidden='true' className='h-4 w-4' />
            </button>
          )}
        </form>

        {scanning && (
          <video
            ref={videoRef}
            muted
            playsInline
            className='bg-base-200 aspect-video w-full rounded-lg object-cover'
            aria-label={_('Camera picture for scanning the barcode')}
          />
        )}

        {looking && (
          <p className='text-base-content/70 text-sm' role='status'>
            {_('Searching…')}
          </p>
        )}
        {results && results.length === 0 && (
          <p className='text-base-content/70 text-sm' role='status'>
            {_('Nothing found. Fill in the details below.')}
          </p>
        )}
        {results && results.length > 0 && (
          <ul className='border-base-300 max-h-56 divide-y overflow-y-auto rounded-lg border'>
            {results.map((candidate, index) => (
              <li key={`${candidate.isbn ?? ''}-${index}`}>
                <button
                  type='button'
                  className='hover:bg-base-200 flex w-full flex-col px-3 py-2 text-start'
                  onClick={() => applyCandidate(candidate)}
                >
                  <span className='line-clamp-1 text-sm font-medium'>{candidate.title}</span>
                  <span className='text-base-content/70 line-clamp-1 text-xs'>
                    {[candidate.author, candidate.publisher, candidate.published]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className='flex items-end gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            void readLink();
          }}
        >
          <label className='flex min-w-0 flex-1 flex-col gap-1'>
            <span className='text-base-content/70 text-xs'>
              {_('Or paste a link to the book in a shop')}
            </span>
            <input
              type='url'
              className='input input-sm eink-bordered w-full'
              value={link}
              maxLength={2000}
              disabled={busy}
              onChange={(event) => setLink(event.target.value)}
            />
          </label>
          <button
            type='submit'
            className='btn btn-sm eink-bordered'
            disabled={busy || looking || !link.trim()}
          >
            {_('Read page')}
          </button>
        </form>

        <hr aria-hidden='true' className='border-base-200' />

        <div className='flex gap-4'>
          <div className='flex w-24 shrink-0 flex-col items-center gap-2'>
            <div className='bg-base-200 flex aspect-[28/41] w-24 items-center justify-center overflow-hidden rounded'>
              {coverBlobUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverBlobUrl} alt={_('Cover')} className='h-full w-full object-cover' />
              ) : (
                <span className='text-base-content/50 px-1 text-center text-xs'>
                  {_('No cover')}
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type='file'
              accept='image/*'
              className='hidden'
              onChange={chooseImage}
            />
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {_('Choose image')}
            </button>
          </div>
          <div className='grid min-w-0 flex-1 grid-cols-2 gap-3'>
            {field('title', _('Title'), { className: 'col-span-2' })}
            {field('author', _('Author'), { className: 'col-span-2' })}
            {field('isbn', _('ISBN'), { max: 20 })}
            {field('published', _('Published'), { max: 20 })}
            {field('publisher', _('Publisher'))}
            {field('language', _('Language'), { max: 20 })}
          </div>
        </div>

        <div className='flex flex-wrap gap-4 text-sm' role='radiogroup' aria-label={_('Ownership')}>
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='radio'
              className='radio radio-sm'
              checked={owned}
              disabled={busy}
              onChange={() => setOwned(true)}
            />
            {_('I own it')}
          </label>
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='radio'
              className='radio radio-sm'
              checked={!owned}
              disabled={busy}
              onChange={() => setOwned(false)}
            />
            {_('Wishlist')}
          </label>
        </div>
        {owned && (
          <label className='flex flex-col gap-1'>
            <span className='text-base-content/70 text-xs'>{_('Location')}</span>
            <input
              type='text'
              className='input input-sm eink-bordered w-full'
              value={location}
              maxLength={PHYSICAL_LOCATION_MAX}
              placeholder={_('For example: living room, shelf 2')}
              disabled={busy}
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
        )}

        {error && (
          <p className='text-error text-sm leading-relaxed' role='alert'>
            {error}
          </p>
        )}
        <div className='flex justify-end gap-2 pt-1'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={close}
            disabled={busy}
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={() => void add()}
            disabled={busy || !form.title.trim()}
          >
            {_('Add to library')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default AddPhysicalBookDialog;
