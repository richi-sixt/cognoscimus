import type { MetadataRoute } from 'next';

// The start page and the sign-in page may be indexed; everything behind the
// login has nothing for a crawler to see.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/auth'],
      disallow: ['/library', '/reader', '/user', '/shared', '/api'],
    },
    sitemap: 'https://cognoscimus.sixt.services/sitemap.xml',
  };
}
