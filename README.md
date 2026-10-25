<<<<<<< HEAD
# cognoscimus
=======
# cognoscimus

A private, self-hosted e-book reader for the web. Sign in, read your EPUB, PDF, MOBI, CBZ and other books in the browser, and share individual books with other users for a limited time.

cognoscimus is a fork of [Readest](https://github.com/readest/readest) (AGPL-3.0). The reading engine, library, annotations and sync model come from Readest; native apps, payment, analytics and third-party integrations have been removed.

## Stack

- Next.js (App Router and Pages API routes), React, TypeScript, Tailwind
- Supabase for authentication and the database
- S3-compatible object storage for book files
- [foliate-js](https://github.com/johnfactotum/foliate-js) as reading engine (vendored in `packages/`)

## Repository layout

```
apps/web         the Next.js web app
packages/        vendored libraries (foliate-js, js-mdict, simplecc-wasm)
patches/         pnpm patches
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
pnpm lint
pnpm test
pnpm --filter @cognoscimus/web build-web
```

Book files are stored in a private S3-compatible bucket and moved directly between browser and bucket through short-lived presigned URLs, so the bucket needs a CORS rule for the app origin. After filling the `S3_*` variables, run once:

```bash
pnpm --filter @cognoscimus/web storage:cors     # S3_CORS_ORIGINS=https://your.domain for other origins
```

`NEXT_PUBLIC_*` variables are baked in at build time, so changing them needs a new build. Keep secrets only in `.env.local`, never in the repository.

## License

AGPL-3.0, see [LICENSE](LICENSE). Because this is a modified version of Readest that is served over a network, its source must be made available to its users under the same license.
