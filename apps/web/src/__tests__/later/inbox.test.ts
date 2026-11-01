import { describe, expect, it } from 'vitest';
import {
  isAuthentic,
  isMailUrl,
  mailUrl,
  parseMail,
  planMail,
  type Mail,
} from '@/libs/later/inbox';

const mail = (over: Partial<Mail> = {}): Mail => ({
  fromAddress: 'me@example.com',
  fromName: 'Me',
  subject: 'Subject',
  messageId: '<a@example.com>',
  html: null,
  text: '',
  ...over,
});

describe('isAuthentic', () => {
  it('accepts a passing DMARC result', () => {
    expect(isAuthentic({ dmarc: { status: { result: 'pass' } } }, 'me@example.com')).toBe(true);
  });

  it('accepts a DKIM signature of the sender domain, also a subdomain', () => {
    const dkim = (signingDomain: string) => ({
      dkim: { results: [{ status: { result: 'pass' }, signingDomain }] },
    });
    expect(isAuthentic(dkim('example.com'), 'me@example.com')).toBe(true);
    expect(isAuthentic(dkim('mail.example.com'), 'me@example.com')).toBe(true);
  });

  it('rejects a signature of another domain', () => {
    const auth = {
      dkim: { results: [{ status: { result: 'pass' }, signingDomain: 'evil.test' }] },
    };
    expect(isAuthentic(auth, 'me@example.com')).toBe(false);
  });

  it('accepts SPF only when the checked domain is the sender domain', () => {
    expect(
      isAuthentic({ spf: { status: { result: 'pass' }, domain: 'example.com' } }, 'me@example.com'),
    ).toBe(true);
    expect(
      isAuthentic({ spf: { status: { result: 'pass' }, domain: 'evil.test' } }, 'me@example.com'),
    ).toBe(false);
  });

  it('rejects a failing or missing result', () => {
    expect(isAuthentic({ dmarc: { status: { result: 'fail' } } }, 'me@example.com')).toBe(false);
    expect(isAuthentic({}, 'me@example.com')).toBe(false);
  });
});

describe('planMail', () => {
  it('treats a lone link as a link', () => {
    const plan = planMail(mail({ text: 'https://example.com/post' }));
    expect(plan).toMatchObject({ type: 'link', url: 'https://example.com/post', note: null });
  });

  it('keeps the text around a link as a note', () => {
    const plan = planMail(mail({ text: 'Read this later\nhttps://example.com/post' }));
    expect(plan).toMatchObject({ type: 'link', note: 'Read this later' });
  });

  it('takes @handle lines as recipients and leaves them out of the note', () => {
    const plan = planMail(mail({ text: 'https://example.com/a\n@anna\n@Ben-2\n@anna' }));
    expect(plan).toMatchObject({ type: 'link', note: null, handles: ['anna', 'ben-2'] });
  });

  it('does not treat a @mention inside a sentence as a recipient', () => {
    const plan = planMail(mail({ text: 'https://example.com/a thanks @anna for it' }));
    expect(plan).toMatchObject({ type: 'link', handles: [] });
  });

  it('stores a long mail as an article, however many links it has', () => {
    const text = `${'word '.repeat(200)}\nhttps://example.com/a`;
    const plan = planMail(mail({ text, html: `<p>${'word '.repeat(200)}</p>` }));
    expect(plan.type).toBe('article');
    if (plan.type === 'article') {
      expect(plan.item.title).toBe('Subject');
      expect(plan.item.siteName).toBe('Me');
      expect(plan.item.wordCount).toBeGreaterThan(150);
      expect(plan.handles).toEqual([]);
    }
  });

  it('builds paragraphs from a plain-text mail', () => {
    const plan = planMail(mail({ text: `${'one '.repeat(80)}\n\n${'two '.repeat(80)}` }));
    expect(plan.type === 'article' && plan.item.contentHtml.match(/<p>/g)).toHaveLength(2);
  });

  it('removes scripts and relative links from a mail', () => {
    const html = `<p>${'text '.repeat(100)}</p><script>alert(1)</script><a href="/x">rel</a><a href="https://ok.test/">ok</a>`;
    const plan = planMail(mail({ text: 'text '.repeat(100), html }));
    if (plan.type !== 'article') throw new Error('expected article');
    expect(plan.item.contentHtml).not.toContain('script');
    expect(plan.item.contentHtml).not.toContain('mail.invalid');
    expect(plan.item.contentHtml).toContain('https://ok.test/');
  });
});

describe('mailUrl', () => {
  it('is stable for a message and distinct between messages', () => {
    expect(mailUrl(mail())).toBe(mailUrl(mail()));
    expect(mailUrl(mail())).not.toBe(mailUrl(mail({ messageId: '<b@example.com>' })));
    expect(isMailUrl(mailUrl(mail()))).toBe(true);
  });
});

describe('parseMail', () => {
  it('reads sender, subject and text from a raw message', async () => {
    const raw = Buffer.from(
      [
        'From: Anna Example <Anna@Example.com>',
        'To: save@in.example.com',
        'Subject: A link',
        'Message-ID: <1@example.com>',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'https://example.com/post',
        '',
      ].join('\r\n'),
    );
    expect(await parseMail(raw)).toMatchObject({
      fromAddress: 'anna@example.com',
      fromName: 'Anna Example',
      subject: 'A link',
      messageId: '<1@example.com>',
      text: 'https://example.com/post',
    });
  });
});
