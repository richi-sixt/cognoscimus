import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const close = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail, close }) },
}));

import { borrowAnswerMail, borrowRequestMail, notifyUser } from '@/libs/notifyServer';

const supabaseFor = (profile: { notify_email?: boolean } | null, email: string | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
      }),
    }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: email ? { email } : null }, error: null }),
      },
    },
  }) as never;

const MAIL = { subject: 's', text: 't' };

describe('notification mail', () => {
  beforeEach(() => {
    sendMail.mockReset();
    close.mockReset();
    process.env['MAIL_SMTP_HOST'] = 'smtp.example.com';
    process.env['MAIL_SMTP_USER'] = 'user';
    process.env['MAIL_FROM'] = 'App <app@example.com>';
  });

  afterEach(() => {
    for (const k of ['MAIL_SMTP_HOST', 'MAIL_SMTP_USER', 'MAIL_FROM', 'MAIL_APP_URL']) {
      delete process.env[k];
    }
  });

  it('sends to the account address', async () => {
    expect(await notifyUser(supabaseFor({ notify_email: true }, 'a@example.com'), 'u', MAIL)).toBe(
      true,
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.com', from: 'App <app@example.com>', subject: 's' }),
    );
    expect(close).toHaveBeenCalled();
  });

  it('sends nothing without SMTP settings, when switched off, or without an address', async () => {
    expect(await notifyUser(supabaseFor({ notify_email: false }, 'a@example.com'), 'u', MAIL)).toBe(
      false,
    );
    expect(await notifyUser(supabaseFor({ notify_email: true }, null), 'u', MAIL)).toBe(false);
    delete process.env['MAIL_SMTP_HOST'];
    expect(await notifyUser(supabaseFor({ notify_email: true }, 'a@example.com'), 'u', MAIL)).toBe(
      false,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never throws when sending fails', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await notifyUser(supabaseFor({ notify_email: true }, 'a@example.com'), 'u', MAIL)).toBe(
      false,
    );
    spy.mockRestore();
  });

  it('keeps line breaks of user text out of the subject', () => {
    const mail = borrowRequestMail({
      requesterHandle: 'bob',
      bookTitle: 'Evil\r\nBcc: x@example.com',
      message: 'Hi\nthere',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain('Message: Hi there');
  });

  it('links to the app only when its address is configured', () => {
    expect(
      borrowRequestMail({ requesterHandle: 'bob', bookTitle: 'B', message: null }).text,
    ).not.toContain('http');
    process.env['MAIL_APP_URL'] = 'https://app.example.com/';
    expect(
      borrowRequestMail({ requesterHandle: 'bob', bookTitle: 'B', message: null }).text,
    ).toContain('https://app.example.com/people');
    expect(borrowAnswerMail({ ownerHandle: 'amy', bookTitle: 'B', accepted: true }).text).toContain(
      'https://app.example.com/shared',
    );
    expect(
      borrowAnswerMail({ ownerHandle: 'amy', bookTitle: 'B', accepted: false }).subject,
    ).toContain('declined');
  });
});
