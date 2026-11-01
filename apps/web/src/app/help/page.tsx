'use client';

import Image from 'next/image';
import { useTheme } from '@/hooks/useTheme';
import { useLandingLang } from '@/components/landing/useLandingLang';
import { HELP_CONTENT } from './content';

// Set at build time, like in the profile; without it the mail section says so.
const INBOX_ADDRESS = process.env['NEXT_PUBLIC_LATER_INBOX_ADDRESS'];

// The user guide. It needs no sign-in: it only describes how things work.
const HelpPage = () => {
  useTheme({ systemUIVisible: false });
  const { lang, chooseLang } = useLandingLang();
  const c = HELP_CONTENT[lang];
  const address = INBOX_ADDRESS ?? (lang === 'de' ? 'deine Inbox-Adresse' : 'your inbox address');

  return (
    <div className='bg-base-100 text-base-content flex min-h-dvh flex-col'>
      <header className='mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5'>
        <a href='/' className='flex min-w-0 items-center gap-3'>
          <Image src='/icon.png' alt='' width={32} height={32} className='rounded-lg' priority />
          <span className='truncate text-lg font-semibold tracking-tight'>Cognoscimus</span>
        </a>
        <div role='group' aria-label={c.languageLabel} className='join shrink-0'>
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
      </header>

      <main className='mx-auto w-full max-w-3xl flex-1 px-6 pb-16'>
        <h1 className='text-3xl font-bold tracking-tight'>{c.title}</h1>
        <p className='text-base-content/75 mt-3 leading-relaxed'>{c.lead}</p>

        <nav aria-label={c.toc} className='bg-base-200/50 mt-8 rounded-2xl p-5'>
          <h2 className='mb-2 text-sm font-semibold uppercase tracking-wide opacity-60'>{c.toc}</h2>
          <ol className='flex flex-col gap-1 text-sm'>
            {c.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className='link link-hover'>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {c.sections.map((section) => (
          <section key={section.id} id={section.id} className='mt-12 scroll-mt-6'>
            <h2 className='text-xl font-semibold tracking-tight'>{section.title}</h2>
            {section.intro && <p className='text-base-content/75 mt-2'>{section.intro}</p>}
            <dl className='mt-4 flex flex-col gap-4'>
              {section.steps.map((step) => (
                <div key={step.title}>
                  <dt className='font-medium'>{step.title}</dt>
                  <dd className='text-base-content/75 mt-1 text-sm leading-relaxed'>
                    {step.text.replace('{address}', address)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <p className='mt-14'>
          <a href='/' className='link link-hover text-sm'>
            {c.back}
          </a>
        </p>
      </main>
    </div>
  );
};

export default HelpPage;
