'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import {
  LANDING_CONTENT,
  LICENSE_URL,
  SOURCE_URL,
  UPSTREAM_URL,
  type LandingLang,
} from './content';

// Public start page for visitors who are not signed in. The first render is
// always English, the same as the server-rendered HTML, so hydration matches;
// the browser language is read right after mounting.
const Landing = () => {
  useTheme({ systemUIVisible: false });
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

  const c = LANDING_CONTENT[lang];

  return (
    <div className='bg-base-100 text-base-content flex min-h-dvh flex-col'>
      <header className='mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5'>
        <div className='flex min-w-0 items-center gap-3'>
          <Image src='/icon.png' alt='' width={36} height={36} className='rounded-lg' priority />
          <span className='truncate text-lg font-semibold tracking-tight'>Cognoscimus</span>
        </div>
        <div className='flex shrink-0 items-center gap-3'>
          <div role='group' aria-label={c.languageLabel} className='join'>
            {(['en', 'de'] as const).map((code) => (
              <button
                key={code}
                type='button'
                onClick={() => chooseLang(code)}
                aria-pressed={lang === code}
                className={`btn btn-xs join-item ${lang === code ? 'btn-neutral' : 'btn-outline'}`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <a href='/auth' className='btn btn-sm btn-primary hidden rounded-lg sm:inline-flex'>
            {c.signIn}
          </a>
        </div>
      </header>

      <main className='mx-auto w-full max-w-5xl flex-1 px-6'>
        <section className='flex flex-col items-start gap-6 py-14 sm:py-20'>
          <h1 className='max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl'>
            {c.headline}
          </h1>
          <p className='text-base-content/75 max-w-2xl text-lg leading-relaxed'>{c.intro}</p>
          <div className='flex flex-wrap items-center gap-3'>
            <a href='/auth' className='btn btn-primary rounded-lg'>
              {c.signIn}
            </a>
            <a href={SOURCE_URL} className='btn btn-ghost rounded-lg'>
              {c.source}
            </a>
          </div>
          <p className='text-base-content/60 text-sm'>{c.invite}</p>
        </section>

        <section aria-labelledby='features' className='pb-16'>
          <h2
            id='features'
            className='mb-6 text-sm font-semibold uppercase tracking-wide opacity-60'
          >
            {c.featuresTitle}
          </h2>
          <div className='grid gap-4 sm:grid-cols-2'>
            {c.features.map((feature) => (
              <article
                key={feature.title}
                className='border-base-300 bg-base-200/50 rounded-2xl border p-5'
              >
                <h3 className='mb-2 text-base font-semibold'>{feature.title}</h3>
                <p className='text-base-content/70 text-sm leading-relaxed'>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className='border-base-300 border-t'>
        <div className='text-base-content/60 mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-6 text-xs sm:flex-row sm:items-center sm:justify-between'>
          <p>{c.license}</p>
          <nav className='flex gap-4'>
            <a href={SOURCE_URL} className='underline'>
              {c.source}
            </a>
            <a href={UPSTREAM_URL} className='underline'>
              Readest
            </a>
            <a href={LICENSE_URL} className='underline'>
              AGPL v3.0
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
