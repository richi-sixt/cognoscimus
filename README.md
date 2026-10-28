# cognoscimus

<img src="apps/web/public/icon.png" alt="" width="72" align="right">

A private, self-hosted e-book reader for the web. Read EPUB, PDF, MOBI, FB2 and comic archives (CBZ) in the browser, keep your place and your notes across devices, and share single books with other users for a limited time. Access is by invitation only.

cognoscimus is a modified version of [Readest](https://github.com/readest/readest) (© Bilingify LLC, AGPL-3.0). The reading engine, the library, the annotation model and the sync model come from Readest. Native apps, payments, analytics and all third-party integrations were removed; sign-in, storage, sharing and the start page are new.

## Features

- **Reading:** paginated and scrolled layout, themes, fonts, highlights, notes and bookmarks (exportable as Markdown), dictionary lookup and translation of selected text, reading progress and statistics.
- **Library:** import by drag and drop, groups, tags, search, reading status. A book is on the device after its first download; the cloud copy can be fetched again at any time.
- **Accounts:** invitation only (sign-ups are disabled), email and password or magic link, row-level security in the database.
- **Storage:** book files live in a private S3-compatible bucket. The browser uploads and downloads them directly through short-lived signed links, checked on the server. Every user has a storage quota.
- **Sharing for a limited time:** share a book with another registered user for 1, 7 or 30 days, and revoke it at any moment. The recipient reads it in the browser; a shared book is never synced, uploaded, exported or shared on, and it is removed from the recipient's device when the grant ends.

## Stack

- Next.js (App Router and Pages API routes), React, TypeScript, Tailwind CSS with daisyUI
- Supabase for authentication and Postgres (migrations in [`supabase/`](supabase/README.md))
- S3-compatible object storage for book files
- [foliate-js](https://github.com/johnfactotum/foliate-js) as reading engine, vendored in `packages/`

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

`NEXT_PUBLIC_*` variables are baked in at build time, so changing them needs a new build. Keep secrets only in `.env.local`, never in the repository. A small server can skip the second type check of `next build` with `SKIP_TYPECHECK=true` (`pnpm lint` already type-checks before every push).

## Comics

CBZ opens directly. RAR archives (CBR) are not read by the browser; convert them once to CBZ, which repacks the pages without recompressing them.

## Changes compared with Readest

- Removed: desktop and mobile apps, payments and plans, analytics, the hosted backend defaults, and the integrations with Pagebound, LocalSend, WebDAV, Google Drive, OneDrive, iCloud, S3 file sync, Readwise, Hardcover and KOSync.
- Added: invitation-only sign-in, a start page, an S3-only storage layer with a quota, time-limited sharing between accounts, and a per-browser library owner check so a second account never inherits the first one's books.

## License

AGPL-3.0, see [LICENSE](LICENSE). Because this is a modified version of Readest that is served over a network, its source is available to its users under the same license, from this repository.
