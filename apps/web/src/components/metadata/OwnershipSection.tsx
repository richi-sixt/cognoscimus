import React, { useEffect, useState } from 'react';
import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import { isPhysicalBook, ownershipOf, PHYSICAL_LOCATION_MAX } from '@/utils/physicalBook';

type Physical = NonNullable<BookMetadata['physical']>;

interface OwnershipSectionProps {
  book: Book;
  metadata: BookMetadata;
  /** Missing for a book that cannot be edited, such as one shared with this account. */
  onChange?: (physical: Physical | undefined) => void;
  children?: React.ReactNode;
}

/**
 * How the book is owned: as a file, as a printed copy, both, or not yet (the
 * wishlist), and where the printed copy stands. Saved as soon as it changes.
 */
const OwnershipSection: React.FC<OwnershipSectionProps> = ({
  book,
  metadata,
  onChange,
  children,
}) => {
  const _ = useTranslation();
  const physical = metadata.physical;
  const printedOnly = isPhysicalBook(book);
  const ownership = ownershipOf({ format: book.format, metadata });
  const hasPrintedCopy = ownership === 'physical' || ownership === 'both';
  const [location, setLocation] = useState(physical?.location ?? '');

  useEffect(() => setLocation(physical?.location ?? ''), [physical?.location]);

  const saveLocation = () => {
    const next = location.trim().slice(0, PHYSICAL_LOCATION_MAX);
    if (!onChange || next === (physical?.location ?? '')) return;
    onChange({ owned: physical?.owned ?? true, ...(next ? { location: next } : {}) });
  };

  const setOwned = (owned: boolean) => {
    if (!onChange) return;
    // A book with a file simply loses the mark; a printed entry keeps its state.
    if (!owned && !printedOnly) onChange(undefined);
    else onChange({ owned, ...(physical?.location ? { location: physical.location } : {}) });
  };

  if (!onChange && !hasPrintedCopy && ownership !== 'wishlist') return null;

  return (
    <div className='text-base-content mb-2 px-4'>
      <span className='text-neutral-content/85 text-base font-semibold'>{_('Ownership')}</span>
      <div className='mt-2 flex flex-col gap-2 text-sm'>
        {printedOnly ? (
          <div className='flex flex-wrap gap-4' role='radiogroup' aria-label={_('Ownership')}>
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='radio'
                className='radio radio-sm'
                checked={ownership === 'physical'}
                disabled={!onChange}
                onChange={() => setOwned(true)}
              />
              {_('I own it')}
            </label>
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='radio'
                className='radio radio-sm'
                checked={ownership === 'wishlist'}
                disabled={!onChange}
                onChange={() => setOwned(false)}
              />
              {_('Wishlist')}
            </label>
          </div>
        ) : (
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='checkbox'
              className='checkbox checkbox-sm'
              checked={ownership === 'both'}
              disabled={!onChange}
              onChange={(event) => setOwned(event.target.checked)}
            />
            {_('I also own it as a printed book')}
          </label>
        )}
        {hasPrintedCopy && (
          <label className='flex items-center gap-2'>
            <span className='shrink-0 font-bold'>{_('Location')}</span>
            <input
              type='text'
              className='input input-sm input-bordered w-full'
              value={location}
              maxLength={PHYSICAL_LOCATION_MAX}
              placeholder={_('For example: living room, shelf 2')}
              disabled={!onChange}
              onChange={(event) => setLocation(event.target.value)}
              onBlur={saveLocation}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </label>
        )}
        {hasPrintedCopy && children}
      </div>
    </div>
  );
};

export default OwnershipSection;
