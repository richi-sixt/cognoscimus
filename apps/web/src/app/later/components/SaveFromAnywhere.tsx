'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

// Ways to save a link from another page or app. The bookmarklet is built from
// the current origin, so it works on any deployment without configuration.
const SaveFromAnywhere = () => {
  const _ = useTranslation();
  const linkRef = useRef<HTMLAnchorElement>(null);

  // React refuses javascript: URLs in href, so the attribute is set directly.
  useEffect(() => {
    linkRef.current?.setAttribute(
      'href',
      `javascript:location.href='${window.location.origin}/later/add?url='+encodeURIComponent(location.href)`,
    );
  }, []);

  return (
    <details className='bg-base-200/60 rounded-2xl px-4 py-3 text-sm'>
      <summary className='cursor-pointer font-medium'>
        {_('Save from other pages and apps')}
      </summary>
      <div className='text-base-content/70 mt-3 flex flex-col gap-3'>
        <p>
          <span className='text-base-content font-medium'>{_('Bookmarklet')}:</span>{' '}
          {_('Drag this button to your bookmarks bar, then click it on any page.')}
        </p>
        <a
          ref={linkRef}
          href='/later'
          draggable
          onClick={(e) => e.preventDefault()}
          className='btn btn-sm btn-outline w-fit cursor-grab'
        >
          {_('Save to Later')}
        </a>
        <p>
          <span className='text-base-content font-medium'>Android:</span>{' '}
          {_('Install the app (browser menu, "Install app"), then use Share and pick Cognoscimus.')}
        </p>
        <p>
          <span className='text-base-content font-medium'>iPhone:</span>{' '}
          {_(
            'The share sheet is not available. Use the bookmarklet in Safari or a Shortcut that opens this address with the link:',
          )}{' '}
          <code className='break-all'>{'/later/add?url=<link>'}</code>
        </p>
      </div>
    </details>
  );
};

export default SaveFromAnywhere;
