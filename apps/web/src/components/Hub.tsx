'use client';

import Link from 'next/link';
import { IoBookOutline, IoBookmarkOutline } from 'react-icons/io5';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';

// Start page for signed-in users: the library of books or the read-later list.
const Hub = () => {
  const _ = useTranslation();
  useTheme();

  const tiles = [
    {
      href: '/library',
      icon: IoBookOutline,
      title: _('Library'),
      text: _('Your books and reading progress'),
    },
    {
      href: '/later',
      icon: IoBookmarkOutline,
      title: _('Later'),
      text: _('Articles you saved to read later'),
    },
  ];

  return (
    <div className='bg-base-100 text-base-content flex min-h-dvh flex-col items-center justify-center px-4'>
      <h1 className='mb-8 text-2xl font-semibold tracking-tight'>Cognoscimus</h1>
      <div className='grid w-full max-w-2xl gap-4 sm:grid-cols-2'>
        {tiles.map(({ href, icon: Icon, title, text }) => {
          const className =
            'bg-base-200/60 hover:bg-base-200 flex flex-col gap-3 rounded-2xl p-6 transition-colors';
          const content = (
            <>
              <Icon className='h-8 w-8' />
              <div>
                <div className='text-lg font-medium'>{title}</div>
                <div className='text-base-content/60 text-sm'>{text}</div>
              </div>
            </>
          );
          // /later is served without cross-origin isolation, so it needs a full
          // page load rather than a client-side route change.
          return href === '/later' ? (
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a key={href} href={href} className={className}>
              {content}
            </a>
          ) : (
            <Link key={href} href={href} className={className}>
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default Hub;
