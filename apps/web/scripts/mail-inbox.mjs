// Receives mail for the Later inbox and hands each message to the app.
//
// It only accepts mail, never sends any. Each message is posted raw to
// INBOX_URL with the envelope in headers; the app decides whether to keep it
// (sender check, rate limit) and this process answers the SMTP session
// accordingly. Run it next to the app:
//
//   INBOX_SECRET=... INBOX_DOMAIN=in.example.com node scripts/mail-inbox.mjs
//
// Environment: INBOX_SECRET (same as the app), INBOX_DOMAIN (accepted recipient
// domain), INBOX_LOCAL (accepted local part, default "save"), INBOX_URL (default
// http://127.0.0.1:3000/api/later/inbox), INBOX_PORT (default 2525),
// INBOX_TLS_KEY and INBOX_TLS_CERT (optional, paths for STARTTLS).
import { readFileSync } from 'node:fs';
import { SMTPServer } from 'smtp-server';

const MAX_BYTES = 10 * 1024 * 1024;
const secret = process.env.INBOX_SECRET;
const domain = process.env.INBOX_DOMAIN?.toLowerCase();
if (!secret || !domain) {
  console.error('INBOX_SECRET and INBOX_DOMAIN are required');
  process.exit(1);
}
const local = (process.env.INBOX_LOCAL ?? 'save').toLowerCase();
const target = process.env.INBOX_URL ?? 'http://127.0.0.1:3000/api/later/inbox';
const port = Number(process.env.INBOX_PORT ?? 2525);
// Without a certificate STARTTLS is not offered: the library's built-in one is public.
const tls =
  process.env.INBOX_TLS_KEY && process.env.INBOX_TLS_CERT
    ? {
        key: readFileSync(process.env.INBOX_TLS_KEY),
        cert: readFileSync(process.env.INBOX_TLS_CERT),
      }
    : { hideSTARTTLS: true };

const smtpError = (message, responseCode) =>
  Object.assign(new Error(message), { responseCode });

const server = new SMTPServer({
  ...tls,
  banner: 'Later inbox',
  authOptional: true,
  disabledCommands: ['AUTH'],
  size: MAX_BYTES,
  maxClients: 20,
  onRcptTo(address, _session, callback) {
    const [name, host] = address.address.toLowerCase().split('@');
    if (name !== local || host !== domain) {
      return callback(smtpError('No such mailbox here', 550));
    }
    callback();
  },
  onData(stream, session, callback) {
    const chunks = [];
    let length = 0;
    stream.on('data', (chunk) => {
      length += chunk.length;
      if (length <= MAX_BYTES) chunks.push(chunk);
    });
    stream.on('end', async () => {
      if (stream.sizeExceeded) return callback(smtpError('Message too large', 552));
      try {
        const response = await fetch(target, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'message/rfc822',
            'x-client-ip': session.remoteAddress ?? '',
            'x-helo': session.clientHostname ?? '',
            'x-mail-from': session.envelope.mailFrom?.address ?? '',
          },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) return callback(smtpError('Try again later', 451));
        const { status, reason } = await response.json();
        if (status === 'saved') return callback();
        console.log(`rejected (${reason})`);
        callback(smtpError('Message not accepted', 550));
      } catch (error) {
        console.error('hand-over failed:', error instanceof Error ? error.message : error);
        callback(smtpError('Try again later', 451));
      }
    });
  },
});

server.on('error', (error) => console.error('smtp error:', error.message));
server.listen(port, () => console.log(`Later inbox listening on ${port}`));
