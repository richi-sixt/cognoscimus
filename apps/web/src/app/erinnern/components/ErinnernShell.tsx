'use client';

import clsx from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IoPersonCircleOutline } from 'react-icons/io5';
import AppSwitcher from '@/components/AppSwitcher';
import { useTranslation } from '@/hooks/useTranslation';

// Header and tabs shared by the two parts of Remember: the quote collection
// and learning.
const ErinnernShell = ({
  active,
  children,
}: {
  active: 'quotes' | 'learn';
  children: ReactNode;
}) => {
  const _ = useTranslation();
  const tabs = [
    { id: 'quotes', href: '/erinnern', label: _('Quotes') },
    { id: 'learn', href: '/erinnern/lernen', label: _('Learn') },
  ] as const;

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center justify-between gap-2 px-4 py-3'>
        <h1 className='text-lg font-semibold'>{_('Remember')}</h1>
        <div className='flex items-center gap-1'>
          <AppSwitcher className='me-1' />
          <button
            type='button'
            onClick={() => window.location.assign('/user?redirect=%2Ferinnern')}
            className='btn btn-ghost btn-circle btn-sm'
            aria-label={_('Account')}
            title={_('Account')}
          >
            <IoPersonCircleOutline className='h-6 w-6' />
          </button>
        </div>
      </header>
      <main className='mx-auto max-w-3xl px-4 pb-16'>
        <div role='tablist' className='tabs tabs-bordered mb-4'>
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              role='tab'
              aria-selected={active === tab.id}
              className={clsx('tab', active === tab.id && 'tab-active')}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        {children}
      </main>
    </div>
  );
};

export default ErinnernShell;
