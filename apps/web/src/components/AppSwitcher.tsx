'use client';

import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import { IoBookOutline, IoBookmarkOutline } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';

// Switches between the two apps. These are plain links on purpose: /later is
// served without cross-origin isolation and the rest of the app with it, and
// isolation is fixed per document, so crossing the border needs a full page load.
const AppSwitcher = ({ className }: { className?: string }) => {
  const _ = useTranslation();
  const inLater = (usePathname() ?? '').startsWith('/later');

  const apps = [
    { href: '/library', label: _('Library'), Icon: IoBookOutline, active: !inLater },
    { href: '/later', label: _('Later'), Icon: IoBookmarkOutline, active: inLater },
  ];

  return (
    <nav aria-label={_('Apps')} className={clsx('join', className)}>
      {apps.map(({ href, label, Icon, active }) => (
        <a
          key={href}
          href={href}
          aria-current={active ? 'page' : undefined}
          title={label}
          className={clsx(
            'btn btn-sm join-item gap-1.5 px-2.5 sm:px-3',
            active ? 'btn-neutral' : 'btn-ghost bg-base-200/70',
          )}
        >
          <Icon className='h-4 w-4' />
          <span className='hidden sm:inline'>{label}</span>
        </a>
      ))}
    </nav>
  );
};

export default AppSwitcher;
