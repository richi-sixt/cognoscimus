import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { isMailUrl } from './constants';
import { sanitizeArticle } from './extract';
import type { IngestedItem } from './ingest';

export { isMailUrl };

/** Mail beyond this size is refused; the receiver enforces the same limit. */
export const INBOX_MAX_BYTES = 10 * 1024 * 1024;
/** Mail a person may send into their library per hour. */
export const INBOX_MAX_PER_HOUR = 60;
/** A note on a mailed link may not exceed this (the column allows 2000). */
const NOTE_MAX = 1000;
/** A mail with at most this many words besides its link counts as "a link with a note". */
const LINK_NOTE_MAX_WORDS = 60;
const EXCERPT_MAX = 300;
const HANDLES_MAX = 3;

/** The parts of a mail that are used; everything else is dropped. */
export interface Mail {
  fromAddress: string | null;
  fromName: string | null;
  subject: string;
  messageId: string | null;
  html: string | null;
  text: string;
}

export const parseMail = async (raw: Buffer): Promise<Mail> => {
  const parsed = await simpleParser(raw, { skipImageLinks: true });
  const from = parsed.from?.value[0];
  const html = typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : null;
  return {
    fromAddress: from?.address?.toLowerCase() ?? null,
    fromName: from?.name?.trim() || null,
    subject: (parsed.subject ?? '').trim(),
    messageId: parsed.messageId?.trim() || null,
    html,
    text: (parsed.text ?? '').trim() || (html ? htmlToText(html) : ''),
  };
};

const htmlToText = (html: string) =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** What `mailauth` reports, reduced to what the decision needs. */
export interface AuthResult {
  dkim?: { results?: { status?: { result?: string }; signingDomain?: string }[] };
  spf?: { status?: { result?: string }; domain?: string };
  dmarc?: { status?: { result?: string } };
}

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

// "mail.example.com" is aligned with "example.com" and the other way round.
const aligned = (a: string | undefined, b: string) => {
  if (!a) return false;
  const x = a.toLowerCase();
  return x === b || x.endsWith(`.${b}`) || b.endsWith(`.${x}`);
};

/**
 * Whether the From address can be believed: DMARC passed, or a DKIM signature or
 * the SPF check passed for the address's own domain. Without this anyone could
 * write into another person's library by faking their address.
 */
export const isAuthentic = (auth: AuthResult, fromAddress: string): boolean => {
  if (auth.dmarc?.status?.result === 'pass') return true;
  const domain = domainOf(fromAddress);
  const dkim = auth.dkim?.results?.some(
    (r) => r.status?.result === 'pass' && aligned(r.signingDomain, domain),
  );
  if (dkim) return true;
  return auth.spf?.status?.result === 'pass' && aligned(auth.spf.domain, domain);
};

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const HANDLE_LINE = /^@([a-z0-9][a-z0-9-]{2,29})\s*$/gim;

export type MailPlan =
  | { type: 'link'; url: string; note: string | null; handles: string[] }
  | { type: 'article'; item: IngestedItem; handles: string[] };

/**
 * Decides what a mail is. A short mail with a link is that link, the rest of the
 * text becoming a note; anything longer is stored as an article of its own (a
 * newsletter, a forwarded text). Lines holding only "@handle" in a short mail
 * name the people it should be offered to; they are not part of the text.
 */
export const planMail = (mail: Mail): MailPlan => {
  const urls = mail.text.match(URL_PATTERN) ?? [];
  const withoutUrls = mail.text.replace(URL_PATTERN, ' ');
  const words = withoutUrls.split(/\s+/).filter(Boolean).length;

  if (urls.length > 0 && words <= LINK_NOTE_MAX_WORDS) {
    const handles = collectHandles(mail.text);
    const note = withoutUrls
      .replace(HANDLE_LINE, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NOTE_MAX);
    return { type: 'link', url: urls[0] as string, note: note || null, handles };
  }
  return { type: 'article', item: mailArticle(mail), handles: [] };
};

const collectHandles = (text: string): string[] =>
  [...new Set([...text.matchAll(HANDLE_LINE)].map((m) => (m[1] as string).toLowerCase()))].slice(
    0,
    HANDLES_MAX,
  );

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const textToHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

/** The address an article from a mail is stored under; it has no page of its own. */
export const mailUrl = (mail: Mail): string => {
  const key = mail.messageId ?? `${mail.fromAddress}|${mail.subject}|${mail.text.slice(0, 200)}`;
  return `mail:${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
};

const mailArticle = (mail: Mail): IngestedItem => {
  // Relative links in a mail have nothing to resolve against; they are dropped
  // along with anything else outside http(s).
  const contentHtml = mail.html
    ? sanitizeArticle(mail.html, 'https://mail.invalid/')
        // Links that still point at the placeholder host were relative.
        .replace(/<a [^>]*href="https:\/\/mail\.invalid\/[^"]*"[^>]*>(.*?)<\/a>/gs, '$1')
    : textToHtml(mail.text);
  const contentText = htmlToText(contentHtml).replace(/\s+/g, ' ');
  const sender = mail.fromName ?? (mail.fromAddress ? domainOf(mail.fromAddress) : 'Mail');
  return {
    kind: 'article',
    title: (mail.subject || 'Mail from ' + sender).slice(0, 300),
    author: mail.fromName?.slice(0, 200) ?? null,
    siteName: sender.slice(0, 200),
    excerpt:
      contentText.length > EXCERPT_MAX ? `${contentText.slice(0, EXCERPT_MAX - 1)}…` : contentText,
    contentHtml,
    contentText,
    thumbnail: null,
    wordCount: contentText ? contentText.split(' ').length : 0,
  };
};
