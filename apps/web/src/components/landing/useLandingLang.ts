import { useEffect, useState } from 'react';
import type { LandingLang } from './content';

/**
 * The language of the pages that exist in English and German only (start page,
 * help). The first render is always English, the same as the server-rendered
 * HTML, so hydration matches; the saved choice or the browser language is read
 * right after mounting.
 */
export const useLandingLang = () => {
  const [lang, setLang] = useState<LandingLang>('en');

  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem('landingLang');
      } catch {
        return null;
      }
    })();
    if (saved === 'de' || saved === 'en') setLang(saved);
    else if (navigator.language?.toLowerCase().startsWith('de')) setLang('de');
  }, []);

  const chooseLang = (next: LandingLang) => {
    setLang(next);
    try {
      localStorage.setItem('landingLang', next);
    } catch {
      // The choice then only lasts for this visit.
    }
  };

  return { lang, chooseLang };
};
