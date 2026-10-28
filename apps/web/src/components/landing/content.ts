// Copy of the public start page. Kept out of the translation files on purpose:
// it only exists in two languages, and a missing string must not fall back to
// the untranslated marker that the other locales use.

export type LandingLang = 'en' | 'de';

export interface LandingContent {
  headline: string;
  intro: string;
  invite: string;
  signIn: string;
  source: string;
  featuresTitle: string;
  features: { title: string; text: string }[];
  license: string;
  languageLabel: string;
}

export const LANDING_CONTENT: Record<LandingLang, LandingContent> = {
  en: {
    headline: 'Your books, on your own terms.',
    intro:
      'A private e-book reader for the browser. Read EPUB, PDF, MOBI and comics, keep your place on every device, and lend single books to others for a limited time.',
    invite: 'Access is by invitation only.',
    signIn: 'Sign in',
    source: 'Source code',
    featuresTitle: 'What it does',
    features: [
      {
        title: 'Read anywhere',
        text: 'EPUB, PDF, MOBI, FB2 and comic archives in one reader, with highlights, notes and your reading position on every device.',
      },
      {
        title: 'A library of your own',
        text: 'Import books by drag and drop. The files stay in private storage and are only reachable through short-lived signed links.',
      },
      {
        title: 'Lend for a limited time',
        text: 'Share a book with another user for 1, 7 or 30 days. It leaves their library when the time is up, or when you revoke it.',
      },
      {
        title: 'Private and open',
        text: 'Invitation only, no tracking and no ads. The source code is public under the AGPL.',
      },
    ],
    license:
      'Cognoscimus is a modified version of Readest, © Bilingify LLC, licensed under the GNU AGPL v3.0.',
    languageLabel: 'Language',
  },
  de: {
    headline: 'Deine Bücher, nach deinen Regeln.',
    intro:
      'Ein privater E-Book-Reader für den Browser. EPUB, PDF, MOBI und Comics lesen, die Leseposition auf jedem Gerät behalten und einzelne Bücher für begrenzte Zeit an andere ausleihen.',
    invite: 'Zugang nur auf Einladung.',
    signIn: 'Anmelden',
    source: 'Quellcode',
    featuresTitle: 'Was er kann',
    features: [
      {
        title: 'Überall lesen',
        text: 'EPUB, PDF, MOBI, FB2 und Comic-Archive in einem Reader, mit Markierungen, Notizen und deiner Leseposition auf jedem Gerät.',
      },
      {
        title: 'Eine eigene Bibliothek',
        text: 'Bücher per Drag and drop importieren. Die Dateien liegen in privatem Speicher und sind nur über kurzlebige, signierte Links erreichbar.',
      },
      {
        title: 'Auf Zeit ausleihen',
        text: 'Ein Buch für 1, 7 oder 30 Tage mit einem anderen Nutzer teilen. Es verschwindet aus dessen Bibliothek, wenn die Zeit abläuft oder du den Zugriff widerrufst.',
      },
      {
        title: 'Privat und offen',
        text: 'Nur auf Einladung, kein Tracking, keine Werbung. Der Quellcode ist unter der AGPL öffentlich.',
      },
    ],
    license:
      'Cognoscimus ist eine veränderte Version von Readest, © Bilingify LLC, lizenziert unter der GNU AGPL v3.0.',
    languageLabel: 'Sprache',
  },
};

export const SOURCE_URL = 'https://github.com/richi-sixt/cognoscimus';
export const UPSTREAM_URL = 'https://github.com/readest/readest';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
