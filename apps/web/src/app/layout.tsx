import * as React from 'react';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ViewTransitions } from '@/components/ViewTransitions';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';

import '../styles/globals.css';

const url = 'https://cognoscimus.sixt.services/';
const title = 'Cognoscimus — Your private e-book reader';
const description =
  'A private, self-hosted e-book reader for EPUB, PDF, MOBI and comics. ' +
  'Lend single books to other users for a limited time. Invitation only, open source.';
const previewImage = 'https://cognoscimus.sixt.services/images/open_graph_preview_read_now.png';

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: title,
    template: '%s | Cognoscimus',
  },
  description,
  generator: 'Next.js',
  manifest: '/manifest.json',
  keywords: ['epub', 'pdf', 'cbz', 'ebook', 'reader', 'self-hosted', 'cognoscimus'],
  authors: [
    {
      name: 'cognoscimus',
      url: 'https://github.com/richi-sixt/cognoscimus',
    },
  ],
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Cognoscimus',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    url,
    title,
    description,
    images: [previewImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [previewImage],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'twitter:domain': 'cognoscimus.sixt.services',
    'twitter:url': url,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // `interactive-widget=resizes-content` is appended client-side on
  // Android only — see Providers.tsx. Other browsers warn about the
  // unrecognized key on every page load, so we keep it out of SSR.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions can inject attributes on <html> before React hydrates it.
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <Script src='/runtime-config.js' strategy='beforeInteractive' />
      </head>
      <body>
        <ViewTransitions>
          <EnvProvider>
            <Providers>{children}</Providers>
          </EnvProvider>
        </ViewTransitions>
      </body>
    </html>
  );
}
