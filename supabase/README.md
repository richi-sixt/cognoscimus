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
| `0008_later.sql` | Later: `later_items` (articles, full-text search), labels, column-level grants (the server writes the text) |
| `0009_later_prune_labels.sql` | labels disappear with their last article |
| `0010_later_trash.sql` | trash (`deleted_at`) |
| `0011_later_highlights.sql` | highlights with notes |
| `0012_later_fetch_state.sql` | fetch state (pending, failed) for imports and broken links |
| `0013_later_collections.sql` | nested collections, loop protection, sidebar counts |
| `0014_later_kind.sql` | item kind: article, link, video, document |
| `0015_later_saved_searches.sql` | saved views |
| `0016_profiles_follows.sql` | profiles (username), follow requests, `later_follow()` |
| `0017_later_sharing.sql` | sharing with followers (items and collections), read functions |
| `0018_later_send.sql` | sending an article to a person, accept or decline |
| `0019_later_explore.sql` | notes on items, the explore feed, saving a shared item |
| `0020_later_feeds.sql` | RSS feeds and their entries |
| `0021_later_inbox.sql` | Mail inbox: extra sender addresses, `later_inbox_owner()`, `later_send_as()` |

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
