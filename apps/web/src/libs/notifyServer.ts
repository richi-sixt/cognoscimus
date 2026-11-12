import type { SupabaseClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// Outgoing e-mail for requests that wait for an answer. It needs an SMTP account
// (MAIL_SMTP_*); without one every function here does nothing, so a deployment
// that has not set it up keeps working. Failures are logged and never break the
// request that triggered the mail.

export interface Mail {
  subject: string;
  text: string;
}

const clean = (value: string, max = 120) =>
  value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);

const appLink = (path: string) => {
  const base = process.env['MAIL_APP_URL']?.replace(/\/+$/, '');
  return base ? `${base}${path}` : null;
};

/** The owner is asked to lend a book. English first, German below, like the app's guide. */
export const borrowRequestMail = (input: {
  requesterHandle: string;
  bookTitle: string;
  message: string | null;
  /** A printed book: it changes hands in person. */
  printed?: boolean;
}): Mail => {
  const who = `@${clean(input.requesterHandle, 40)}`;
  const title = clean(input.bookTitle);
  const link = appLink('/people');
  const note = input.message ? clean(input.message, 300) : null;
  return {
    subject: `${who} would like to borrow "${title}"`,
    text: [
      input.printed
        ? `${who} asks to borrow your printed copy of "${title}".`
        : `${who} asks to borrow "${title}".`,
      note ? `Message: ${note}` : null,
      link ? `Answer it here: ${link}` : 'Answer it under "People" in the app.',
      '',
      input.printed
        ? `${who} möchte dein gedrucktes Exemplar von «${title}» ausleihen.`
        : `${who} möchte «${title}» ausleihen.`,
      note ? `Nachricht: ${note}` : null,
      link ? `Hier beantworten: ${link}` : 'Beantworte die Anfrage in der App unter «Personen».',
      '',
      'You can switch these e-mails off in your profile. / Diese E-Mails lassen sich im Profil ausschalten.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  };
};

/** The requester learns whether the book was lent. */
export const borrowAnswerMail = (input: {
  ownerHandle: string;
  bookTitle: string;
  accepted: boolean;
  /** A printed book: nothing appears in the app, the owner hands it over. */
  printed?: boolean;
}): Mail => {
  const who = `@${clean(input.ownerHandle, 40)}`;
  const title = clean(input.bookTitle);
  const link = appLink('/shared');
  return {
    subject: input.accepted
      ? `${who} lent you "${title}"`
      : `${who} declined your request for "${title}"`,
    text: !input.accepted
      ? [
          `${who} declined your request for "${title}".`,
          '',
          `${who} hat deine Anfrage für «${title}» abgelehnt.`,
        ].join('\n')
      : input.printed
        ? [
            `${who} will lend you the printed copy of "${title}" and hand it to you in person.`,
            '',
            `${who} leiht dir das gedruckte Exemplar von «${title}» und übergibt es dir persönlich.`,
          ].join('\n')
        : [
            `${who} lent you "${title}".`,
            link
              ? `Open it under "Shared with me": ${link}`
              : 'Open it under "Shared with me" in the app.',
            '',
            `${who} hat dir «${title}» geliehen.`,
            link
              ? `Öffne es unter «Mit mir geteilt»: ${link}`
              : 'Öffne es in der App unter «Mit mir geteilt».',
          ].join('\n'),
  };
};

const isConfigured = () =>
  !!(process.env['MAIL_SMTP_HOST'] && process.env['MAIL_SMTP_USER'] && process.env['MAIL_FROM']);

const SEND_TIMEOUT_MS = 8000;

const send = async (to: string, mail: Mail) => {
  const port = Number(process.env['MAIL_SMTP_PORT'] ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env['MAIL_SMTP_HOST'],
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS, which the server must offer.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env['MAIL_SMTP_USER'], pass: process.env['MAIL_SMTP_PASS'] },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  try {
    await transport.sendMail({ from: process.env['MAIL_FROM'], to, ...mail });
  } finally {
    transport.close();
  }
};

/**
 * Mails `userId` about something, unless mail is not configured, the person
 * switched notifications off in their profile, or no address is known. The
 * address comes from the account, never from another user.
 */
export const notifyUser = async (
  supabase: SupabaseClient,
  userId: string,
  mail: Mail,
): Promise<boolean> => {
  if (!isConfigured()) return false;
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('notify_email')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (profile?.notify_email === false) return false;

    const { data: account, error: accountError } = await supabase.auth.admin.getUserById(userId);
    if (accountError) throw accountError;
    const to = account.user?.email;
    if (!to) return false;

    await send(to, mail);
    return true;
  } catch (error) {
    console.error('notification mail failed:', error);
    return false;
  }
};
