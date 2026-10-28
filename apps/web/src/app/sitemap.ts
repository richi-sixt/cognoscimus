import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://cognoscimus.sixt.services/', changeFrequency: 'monthly' }];
}
