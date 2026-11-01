import { createHash, timingSafeEqual } from 'node:crypto';
import { authenticate } from 'mailauth';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { fetchPage, normalizeUrl } from '@/libs/later/fetchPage';
import { bookmarkFromUrl, ingestPage, type IngestedItem, toRow } from '@/libs/later/ingest';
import {
  type AuthResult,
  INBOX_MAX_BYTES,
  INBOX_MAX_PER_HOUR,
  isAuthentic,
  mailUrl,
  parseMail,
  planMail,
} from '@/libs/later/inbox';

const digest = (value: string) => createHash('sha256').update(value).digest();

type Outcome = 'saved' | 'rejected' | 'busy';
const reply = (status: Outcome, reason?: string, httpStatus = 200) =>
  NextResponse.json({ status, reason }, { status: httpStatus });

// POST /api/later/inbox — called by the mail receiver, not by people. The body is
// the raw message; the envelope comes in headers. The sender's address decides
// whose library gets the item, and only when SPF or DKIM vouch for it. Protected
// by the INBOX_SECRET environment variable, sent as a bearer token.
export async function POST(request: Request) {
  const secret = process.env['INBOX_SECRET'];
  if (!secret) {
    return NextResponse.json({ error: 'The mail inbox is not configured' }, { status: 503 });
  }
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!timingSafeEqual(digest(given), digest(secret))) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length === 0 || raw.length > INBOX_MAX_BYTES) return reply('rejected', 'size');

  try {
    const mail = await parseMail(raw);
    if (!mail.fromAddress) return reply('rejected', 'no_sender');

    const auth = (await authenticate(raw, {
      ip: request.headers.get('x-client-ip') ?? undefined,
      helo: request.headers.get('x-helo') ?? undefined,
      sender: request.headers.get('x-mail-from') ?? mail.fromAddress,
      disableArc: true,
      disableBimi: true,
    })) as unknown as AuthResult;
    if (!isAuthentic(auth, mail.fromAddress)) return reply('rejected', 'unauthenticated');

    const supabase = createSupabaseAdminClient();
    const { data: userId, error: ownerError } = await supabase.rpc('later_inbox_owner', {
      p_email: mail.fromAddress,
    });
    if (ownerError) throw ownerError;
    if (!userId) return reply('rejected', 'unknown_sender');

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count, error: countError } = await supabase
      .from('later_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('saved_at', since);
    if (countError) throw countError;
    if ((count ?? 0) >= INBOX_MAX_PER_HOUR) return reply('rejected', 'rate_limited');

    const plan = planMail(mail);
    let url: string;
    let item: IngestedItem;
    let note: string | null = null;
    if (plan.type === 'article') {
      url = mailUrl(mail);
      item = plan.item;
    } else {
      note = plan.note;
      const target = normalizeUrl(plan.url);
      try {
        const page = await fetchPage(target);
        url = normalizeUrl(page.finalUrl.toString()).toString();
        item = ingestPage(page.html, url);
      } catch {
        // The mail must not get lost because the page is unreachable: keep the link.
        url = target.toString();
        item = bookmarkFromUrl(target, 'link');
      }
    }

    const { data, error } = await supabase
      .from('later_items')
      .upsert(
        { user_id: userId, url, ...toRow(item), deleted_at: null, ...(note ? { note } : {}) },
        { onConflict: 'user_id,url' },
      )
      .select('id')
      .single();
    if (error) throw error;

    for (const handle of plan.handles) {
      await supabase.rpc('later_send_as', { p_sender: userId, p_item: data.id, p_handle: handle });
    }
    return reply('saved');
  } catch (error) {
    console.error('later inbox failed:', error);
    // The receiver turns this into a temporary SMTP error, so the sender retries.
    return reply('busy', undefined, 500);
  }
}
