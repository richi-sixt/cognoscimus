# cognoscimus

<img src="apps/web/public/icon.png" alt="" width="72" align="right">

A private, self-hosted reading place for the web, with two parts under one account:

- **Library** (`/library`): read EPUB, PDF, MOBI, FB2 and comic archives (CBZ) in the browser, keep your place and your notes across devices, and share single books with other users for a limited time.
- **Later** (`/later`): save web articles and links, read them later in peace, highlight, organise and search them, follow a few people to see what they share, and subscribe to RSS feeds.

Access is by invitation only.

The library is a modified version of [Readest](https://github.com/readest/readest) (© Bilingify LLC, AGPL-3.0). The reading engine, the library, the annotation model and the sync model come from Readest. Native apps, payments, analytics and all third-party integrations were removed; sign-in, storage, sharing and the start page are new. Later is written from scratch. [Omnivore](https://github.com/omnivore-app/omnivore) and Raindrop.io inspired its concepts; no code was taken from either.

## Features

### Library

- **Reading:** paginated and scrolled layout, themes, fonts, highlights, notes and bookmarks (exportable as Markdown), dictionary lookup and translation of selected text, reading progress and statistics.
- **Library:** import by drag and drop, groups, tags, search, reading status. A book is on the device after its first download; the cloud copy can be fetched again at any time.
- **Accounts:** invitation only (sign-ups are disabled), email and password or magic link, row-level security in the database.
- **Storage:** book files live in a private S3-compatible bucket. The browser uploads and downloads them directly through short-lived signed links, checked on the server. Every user has a storage quota.
- **Sharing for a limited time:** share a book with another registered user for 1, 7 or 30 days, and revoke it at any moment. The recipient reads it in the browser; a shared book is never synced, uploaded, exported or shared on, and it is removed from the recipient's device when the grant ends.

### Later

- **Saving and reading:** save an address and the readable text is cut out (`linkedom` and Mozilla Readability), sanitised and shown in a calm reader with full-text search, reading progress, archive and a trash (30 days to restore). Save from the share menu on a phone or with a bookmarklet.
- **Kinds:** every item is an article, link, video or document. The kind comes from the address, then the page's `og:type`, then the amount of readable text. Documents are not downloaded.
- **Organising:** nested collections, labels, saved views, bulk actions, a note on every item, and highlights with notes inside articles. Import from a Raindrop export turns folders into collections and tags into labels.
- **People:** one username for the whole app, private by default and found only by its exact name. Following is a request that is accepted, declined or blocked. Articles or whole collections can be shared with followers, who see only what was shared (title, text, source, kind and note, never labels or private collections). An article can also be sent to a person, who opens it and decides whether to save it. "Explore" shows everything the people you follow share.
- **Feeds:** follow RSS and Atom feeds (also by a website's address) and import OPML. New entries wait in their own stream until they are saved as articles or dismissed.
- **Safety:** fetching other people's addresses checks every redirect against internal addresses. Sharing rules live in the database (grants, row-level security, functions), not in the app.

## Stack

- Next.js (App Router and Pages API routes), React, TypeScript, Tailwind CSS with daisyUI
- Supabase for authentication and Postgres (migrations in [`supabase/`](supabase/README.md))
- S3-compatible object storage for book files
- [foliate-js](https://github.com/johnfactotum/foliate-js) as reading engine, vendored in `packages/`
- `linkedom`, `@mozilla/readability` and `fast-xml-parser` for Later (articles and feeds)

## Repository layout

```
apps/web         the Next.js web app
packages/        vendored libraries (foliate-js, js-mdict, simplecc-wasm)
patches/         pnpm patches
supabase/        SQL migrations (run in order)
deploy.sh        pull, install and build; restarting the server is left to the environment
```

## Development

Requires Node.js 22 and pnpm (activate with `corepack enable`).

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # then fill in the values
pnpm --filter @cognoscimus/web setup-vendors          # copy the pdf.js assets once
pnpm dev-web                                          # http://localhost:3000
```

Useful commands:

```bash
pnpm lint                                  # type check and lint
pnpm test                                  # unit tests
pnpm --filter @cognoscimus/web build-web   # production build
apps/web/scripts/generate-icons.sh         # icons and preview image from public/logo.svg
```

The Supabase project needs the migrations in `supabase/migrations` applied in order, sign-ups switched off, and the app's callback URL (`<origin>/auth/callback`) in the redirect URLs. Users are invited from the Supabase dashboard.

Book files are moved directly between browser and bucket, so the bucket needs a CORS rule for the app origin. After filling the `S3_*` variables, run once:

```bash
pnpm --filter @cognoscimus/web storage:cors     # S3_CORS_ORIGINS=https://your.domain for other origins
```

Later's feeds are fetched by a scheduled job: set a random `CRON_SECRET` and have your scheduler call `POST /api/later/feeds/poll` with `Authorization: Bearer <CRON_SECRET>` every 15 minutes or so. Without the variable the route answers 503.

`NEXT_PUBLIC_*` variables are baked in at build time, so changing them needs a new build. Keep secrets only in `.env.local`, never in the repository. A small server can skip the second type check of `next build` with `SKIP_TYPECHECK=true` (`pnpm lint` already type-checks before every push).

## Comics

CBZ opens directly. RAR archives (CBR) are not read by the browser; convert them once to CBZ, which repacks the pages without recompressing them.

## Changes compared with Readest

- Removed: desktop and mobile apps, payments and plans, analytics, the hosted backend defaults, and the integrations with Pagebound, LocalSend, WebDAV, Google Drive, OneDrive, iCloud, S3 file sync, Readwise, Hardcover and KOSync.
- Added: invitation-only sign-in, a start page, an S3-only storage layer with a quota, time-limited sharing between accounts, and a per-browser library owner check so a second account never inherits the first one's books.
- Added: Later (read-later articles and links, collections, following people, RSS feeds), which has no counterpart in Readest.

## License

AGPL-3.0, see [LICENSE](LICENSE). Because this is a modified version of Readest that is served over a network, its source is available to its users under the same license, from this repository.
