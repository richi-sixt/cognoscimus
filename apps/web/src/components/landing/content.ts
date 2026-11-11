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
  laterTitle: string;
  laterIntro: string;
  laterFeatures: { title: string; text: string }[];
  help: string;
  license: string;
  languageLabel: string;
  contact: string;
  upstreamUrl: string;
}

export const LANDING_CONTENT: Record<LandingLang, LandingContent> = {
  en: {
    headline: 'Your books, on your own terms.',
    intro:
      'A private e-book reader for the browser, with a read-later reader for the web next to it. Read EPUB, PDF, MOBI and comics, keep your place on every device, and lend single books to others for a limited time.',
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
    laterTitle: 'And Later, for the web',
    laterIntro:
      'Next to the books there is Later, a private read-later reader. Save a link and read the article without ads or distractions, whenever it suits you.',
    laterFeatures: [
      {
        title: 'Save and read',
        text: 'Paste a link, use the bookmarklet or share from your phone. Articles are stored as clean text, with highlights, notes, labels and search.',
      },
      {
        title: 'Collections and labels',
        text: 'Sort links into nested collections, add labels, keep saved views and move old Raindrop bookmarks over.',
      },
      {
        title: 'Follow and share',
        text: 'Follow people you know and see what they chose to share, or send them a single article. Everything is private until you decide otherwise.',
      },
      {
        title: 'Feeds and mail',
        text: 'Subscribe to RSS and Atom feeds and pick what to keep, or mail a link to your own inbox address.',
      },
    ],
    help: 'Help',
    license:
      '© 2026 Rüchan Sixt. Cognoscimus is a modified version of Readest, © Bilingify LLC, licensed under the GNU AGPL v3.0.',
    languageLabel: 'Language',
    contact: 'Contact',
    upstreamUrl: 'https://readest.com',
  },
  de: {
    headline: 'Deine Bücher, nach deinen Regeln.',
    intro:
      'Ein privater E-Book-Reader für den Browser, mit einem Reader zum späteren Lesen von Webseiten daneben. EPUB, PDF, MOBI und Comics lesen, die Leseposition auf jedem Gerät behalten und einzelne Bücher für begrenzte Zeit an andere ausleihen.',
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
    laterTitle: 'Und Later, für das Web',
    laterIntro:
      'Neben den Büchern gibt es Later, einen privaten Reader zum späteren Lesen. Einen Link speichern und den Artikel ohne Werbung und Ablenkung lesen, wann es passt.',
    laterFeatures: [
      {
        title: 'Speichern und lesen',
        text: 'Link einfügen, das Bookmarklet nutzen oder vom Handy teilen. Artikel werden als sauberer Text gespeichert, mit Markierungen, Notizen, Labels und Suche.',
      },
      {
        title: 'Sammlungen und Labels',
        text: 'Links in verschachtelte Sammlungen einordnen, mit Labels versehen, Ansichten speichern und alte Raindrop-Lesezeichen übernehmen.',
      },
      {
        title: 'Folgen und teilen',
        text: 'Bekannten folgen und sehen, was sie teilen wollen, oder ihnen einen einzelnen Artikel senden. Alles bleibt privat, bis du es anders entscheidest.',
      },
      {
        title: 'Feeds und Mail',
        text: 'RSS- und Atom-Feeds abonnieren und auswählen, was bleibt, oder einen Link an die eigene Inbox-Adresse mailen.',
      },
    ],
    help: 'Hilfe',
    license:
      '© 2026 Rüchan Sixt. Cognoscimus ist eine veränderte Version von Readest, © Bilingify LLC, lizenziert unter der GNU AGPL v3.0.',
    languageLabel: 'Sprache',
    contact: 'Kontakt',
    upstreamUrl: 'https://readest.com/de',
  },
};

export const SOURCE_URL = 'https://github.com/richi-sixt/cognoscimus';

// The contact address is kept in two parts and put together in the browser only
// (see Landing.tsx), so it never appears in the HTML that crawlers fetch.
export const CONTACT_USER = 'cognoscimus';
export const CONTACT_DOMAIN = 'sixt.services';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
