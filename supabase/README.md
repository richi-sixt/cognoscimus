# Database

SQL migrations for the Supabase project, derived from the Readest schema and trimmed to what cognoscimus uses.

| File | Content |
|---|---|
| `0001_core.sql` | books, per-book config, notes, file registry (storage quota) |
| `0002_replicas.sql` | cross-device sync of user assets (CRDT replicas, encryption salts) |
| `0003_stats.sql` | reading statistics |
| `0004_book_shares.sql` | anonymous share links (dropped again by 0007) |
| `0005_authorization.sql` | admin allowlist and `is_admin()` |
| `0006_storage_usage.sql` | `storage_usage_bytes()`, the per-user quota sum (server only) |
| `0007_book_grants.sql` | `book_grants` (time-limited, account-bound sharing), `find_user_id_by_email()`; removes `book_shares` |

Run them once, in numeric order, in the Supabase SQL editor (or `supabase db push`).

Every table has row-level security: users only see their own rows. `files` and `admin_emails` are not writable through the API; only the server (service role) writes `files`.

One-off scripts (for example inserting the first admin email) belong in `supabase/local/`, which is gitignored.

## Local development

`supabase start` runs a separate Postgres, Auth and Studio in Docker and applies every migration in `supabase/migrations/` (needs Docker; the CLI is configured in `config.toml`, ports are shifted by 100 so it can run next to other Supabase projects).

```bash
supabase start      # API http://127.0.0.1:54421, Studio http://127.0.0.1:54423
supabase db reset   # drop the local data and re-apply all migrations
supabase stop
```

`apps/web/.env.development.local` (gitignored) points `pnpm dev` at this local instance and takes precedence over `.env.local`. Create a test user in Studio under Authentication.
