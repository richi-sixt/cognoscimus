-- Derived from the Readest schema (AGPL-3.0), trimmed to what cognoscimus uses.
-- Run once, in numeric order, in the Supabase SQL editor or with `supabase db push`.

-- Cross-device sync of user assets (dictionaries, fonts, settings, ...) as CRDT replicas.

-- Migration 003: Add replicas table for cross-device sync of user-imported assets
-- (dictionaries, fonts, textures, OPDS catalogs, dict settings — gated by
--  a per-kind allowlist enforced both in DB CHECK and in server validation).
-- See ~/.claude/plans/vivid-orbiting-thimble.md and
-- src/libs/crdt.README.md for the design.

-- ─────────────────────────────────────────────────────────────────────────
-- replica_keys: per-account PBKDF2 salt for the encrypted-fields envelope.
-- One row per (user_id, alg). A passphrase rotation appends a new row;
-- forgot-passphrase deletes all rows for the user (and the migrate-time
-- check on encrypted envelopes makes them unreadable client-side).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.replica_keys (
  user_id uuid NOT NULL,
  salt_id text NOT NULL,
  alg text NOT NULL,
  salt bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT replica_keys_pkey PRIMARY KEY (user_id, salt_id),
  CONSTRAINT replica_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.replica_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY replica_keys_select ON public.replica_keys
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_keys_insert ON public.replica_keys
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_keys_delete ON public.replica_keys
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- replicas: polymorphic per-user CRDT-backed metadata.
--   kind            — server-allowlisted: 'dictionary' in PR 1; future kinds
--                     require a server release that updates the CHECK below.
--   fields_jsonb    — per-field LWW envelope: {<field>: {v, t: <Hlc>, s}}
--                     PR-validated 64 KiB / 64-field caps server-side.
--   manifest_jsonb  — committed last after binary upload completes.
--                     null = "binaries pending"; row not yet downloadable.
--   deleted_at_ts   — remove-wins tombstone HLC. A field write does NOT
--                     revive a tombstoned row.
--   reincarnation   — explicit re-import token; swaps row to alive under a
--                     new logical identity.
--   updated_at_ts   — max(field HLCs, deleted_at_ts, row-level operation
--                     HLCs such as manifest commits). Used as the pull cursor.
--   schema_version  — per-kind schema bump; server enforces bounds.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.replicas (
  user_id uuid NOT NULL,
  kind text NOT NULL,
  replica_id text NOT NULL,
  fields_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_jsonb jsonb NULL,
  deleted_at_ts text NULL,
  reincarnation text NULL,
  updated_at_ts text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  modified_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT replicas_pkey PRIMARY KEY (user_id, kind, replica_id),
  CONSTRAINT replicas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Server allowlist for kind. Adding a new kind = a coordinated client +
  -- server PR; this CHECK is part of the server release.
  CONSTRAINT replicas_kind_allowlist CHECK (kind IN ('dictionary', 'font', 'texture', 'settings', 'bookshelf', 'custom_translator', 'translation_prompt', 'custom_tts')),
  -- Hard caps. validateRow() in src/libs/replica-schemas.ts enforces the
  -- same bounds at the API layer with a clearer error code; these CHECKs
  -- are belt-and-suspenders for direct DB writes.
  CONSTRAINT replicas_fields_size CHECK (pg_column_size(fields_jsonb) <= 65536),
  CONSTRAINT replicas_schema_version CHECK (schema_version >= 1 AND schema_version <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_replicas_pull_cursor
  ON public.replicas (user_id, kind, updated_at_ts);

ALTER TABLE public.replicas ENABLE ROW LEVEL SECURITY;

CREATE POLICY replicas_select ON public.replicas
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_insert ON public.replicas
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_update ON public.replicas
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_delete ON public.replicas
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Migration 004: crdt_merge_replica() — atomic CRDT merge for the replicas
-- table. Mirrors src/libs/crdt.ts mergeReplica() so client and server
-- converge on identical merge results.
--
-- Properties (verified by tests in src/__tests__/libs/crdt.test.ts and
-- the server-merge race test):
--   * commutative, associative, idempotent on fields_jsonb
--   * remove-wins: a field write never revives a tombstone (deleted_at_ts
--     stays the larger of the two sides)
--   * preserves unknown fields from either side (forwards-compat across
--     schemaVersion bumps)
--   * deviceId tiebreak when two field envelopes share the same HLC
--
-- Called via INSERT … ON CONFLICT … DO UPDATE in a single SQL statement
-- so two concurrent pushes can't interleave fetch-then-upsert. RUNS AS
-- SECURITY INVOKER (default) — the surrounding INSERT/UPDATE is RLS-
-- gated, so we don't need DEFINER. The server endpoint additionally
-- asserts auth.uid() = NEW.user_id before invoking the upsert.

-- ─────────────────────────────────────────────────────────────────────────
-- HLC max helper. NULLs lose. Plain text comparison since the HLC packing
-- format makes lexicographic order match temporal order.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hlc_max(a text, b text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN a IS NULL THEN b
    WHEN b IS NULL THEN a
    WHEN a >= b THEN a
    ELSE b
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Field-level LWW merge for fields_jsonb. Per-key: keep the envelope with
-- the larger envelope.t (HLC string). Tie on HLC: deviceId (envelope.s)
-- lex-order tiebreak. Preserves keys present on either side.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crdt_merge_fields(local_fields jsonb, remote_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  result jsonb := COALESCE(local_fields, '{}'::jsonb);
  k text;
  l_env jsonb;
  r_env jsonb;
  l_t text;
  r_t text;
  l_s text;
  r_s text;
BEGIN
  IF remote_fields IS NULL THEN
    RETURN result;
  END IF;
  FOR k IN SELECT jsonb_object_keys(remote_fields) LOOP
    r_env := remote_fields -> k;
    l_env := result -> k;
    IF l_env IS NULL THEN
      result := jsonb_set(result, ARRAY[k], r_env, true);
    ELSE
      l_t := l_env ->> 't';
      r_t := r_env ->> 't';
      IF r_t > l_t THEN
        result := jsonb_set(result, ARRAY[k], r_env, true);
      ELSIF r_t = l_t THEN
        l_s := COALESCE(l_env ->> 's', '');
        r_s := COALESCE(r_env ->> 's', '');
        IF r_s > l_s THEN
          result := jsonb_set(result, ARRAY[k], r_env, true);
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Content updated_at_ts = max over field HLCs and tombstone HLC.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crdt_compute_updated_at(fields jsonb, deleted_at text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  result text := COALESCE(deleted_at, '0000000000000-00000000-');
  k text;
  env jsonb;
  t text;
BEGIN
  IF fields IS NULL THEN
    RETURN result;
  END IF;
  FOR k IN SELECT jsonb_object_keys(fields) LOOP
    env := fields -> k;
    t := env ->> 't';
    IF t IS NOT NULL AND t > result THEN
      result := t;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Full row merge. Used in:
--   INSERT INTO replicas (...) VALUES (...)
--   ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
--     fields_jsonb   = crdt_merge_fields(replicas.fields_jsonb, EXCLUDED.fields_jsonb),
--     deleted_at_ts  = hlc_max(replicas.deleted_at_ts, EXCLUDED.deleted_at_ts),
--     reincarnation  = CASE WHEN replicas.reincarnation = EXCLUDED.reincarnation
--                           THEN replicas.reincarnation
--                           WHEN EXCLUDED.updated_at_ts > replicas.updated_at_ts
--                           THEN EXCLUDED.reincarnation
--                           ELSE replicas.reincarnation END,
--     manifest_jsonb = CASE WHEN EXCLUDED.updated_at_ts > replicas.updated_at_ts
--                           THEN EXCLUDED.manifest_jsonb
--                           ELSE replicas.manifest_jsonb END,
--     schema_version = GREATEST(replicas.schema_version, EXCLUDED.schema_version),
--     updated_at_ts  = crdt_compute_updated_at(
--                        crdt_merge_fields(replicas.fields_jsonb, EXCLUDED.fields_jsonb),
--                        hlc_max(replicas.deleted_at_ts, EXCLUDED.deleted_at_ts)
--                      ),
--     modified_at    = now()
--
-- Or via the wrapper below for shorter call sites.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crdt_merge_replica(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_fields_jsonb jsonb,
  p_manifest_jsonb jsonb,
  p_deleted_at_ts text,
  p_reincarnation text,
  p_updated_at_ts text,
  p_schema_version integer
) RETURNS public.replicas
LANGUAGE plpgsql
AS $$
DECLARE
  result public.replicas;
BEGIN
  INSERT INTO public.replicas AS r (
    user_id, kind, replica_id,
    fields_jsonb, manifest_jsonb, deleted_at_ts,
    reincarnation, updated_at_ts, schema_version
  ) VALUES (
    p_user_id, p_kind, p_replica_id,
    COALESCE(p_fields_jsonb, '{}'::jsonb),
    p_manifest_jsonb, p_deleted_at_ts,
    p_reincarnation, p_updated_at_ts, p_schema_version
  )
  ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
    fields_jsonb   = public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
    deleted_at_ts  = public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts),
    reincarnation  = CASE
                       WHEN r.reincarnation IS NOT DISTINCT FROM EXCLUDED.reincarnation
                         THEN r.reincarnation
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.reincarnation
                       ELSE r.reincarnation
                     END,
    manifest_jsonb = CASE
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.manifest_jsonb
                       ELSE r.manifest_jsonb
                     END,
    schema_version = GREATEST(r.schema_version, EXCLUDED.schema_version),
    updated_at_ts  = public.crdt_compute_updated_at(
                       public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
                       public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                     ),
    modified_at    = now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Surface the function to the API role only after an explicit user-id
-- match check in src/pages/api/sync/replicas.ts. RLS on the replicas
-- table is the second line of defense (the function runs as caller).
GRANT EXECUTE ON FUNCTION public.hlc_max(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_merge_fields(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_compute_updated_at(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_merge_replica(uuid, text, text, jsonb, jsonb, text, text, text, integer) TO authenticated;

-- Migration 005: keep replica updated_at_ts as the max row-operation HLC.
--
-- Migration 004 recomputed updated_at_ts from fields_jsonb + deleted_at_ts
-- after every conflict. That loses manifest-only operation timestamps:
-- manifest_jsonb can change, but pull cursors do not advance, so a device
-- that already pulled the metadata-only row can miss the downloadable
-- transition. Preserve the max of existing row timestamp, incoming row
-- timestamp, and content/tombstone timestamp.
--
-- Also treat incoming manifest_jsonb = null as "no manifest update" on
-- conflict. Metadata-only rows use null, and must not clear an existing
-- committed manifest.
--
-- Reincarnation is derived from the newest non-null token candidate that
-- is newer than the merged tombstone. Null metadata/manifest rows do not
-- clear a token; a newer tombstone clears it because no token candidate is
-- newer than that tombstone. Without this, editing a reincarnated
-- dictionary title publishes p_reincarnation = null and erases the revival
-- token.

CREATE OR REPLACE FUNCTION public.crdt_merge_replica(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_fields_jsonb jsonb,
  p_manifest_jsonb jsonb,
  p_deleted_at_ts text,
  p_reincarnation text,
  p_updated_at_ts text,
  p_schema_version integer
) RETURNS public.replicas
LANGUAGE plpgsql
AS $$
DECLARE
  result public.replicas;
BEGIN
  INSERT INTO public.replicas AS r (
    user_id, kind, replica_id,
    fields_jsonb, manifest_jsonb, deleted_at_ts,
    reincarnation, updated_at_ts, schema_version
  ) VALUES (
    p_user_id, p_kind, p_replica_id,
    COALESCE(p_fields_jsonb, '{}'::jsonb),
    p_manifest_jsonb, p_deleted_at_ts,
    p_reincarnation, p_updated_at_ts, p_schema_version
  )
  ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
    fields_jsonb   = public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
    deleted_at_ts  = public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts),
    reincarnation  = CASE
                       WHEN r.reincarnation IS NULL AND EXCLUDED.reincarnation IS NULL
                         THEN NULL
                       WHEN r.reincarnation IS NOT NULL AND EXCLUDED.reincarnation IS NULL
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR r.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN r.reincarnation
                                ELSE NULL
                              END
                       WHEN r.reincarnation IS NULL AND EXCLUDED.reincarnation IS NOT NULL
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR EXCLUDED.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN EXCLUDED.reincarnation
                                ELSE NULL
                              END
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR EXCLUDED.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN EXCLUDED.reincarnation
                                ELSE NULL
                              END
                       ELSE CASE
                              WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                OR r.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                THEN r.reincarnation
                              ELSE NULL
                            END
                     END,
    manifest_jsonb = CASE
                       WHEN EXCLUDED.manifest_jsonb IS NULL
                         THEN r.manifest_jsonb
                       WHEN r.manifest_jsonb IS NULL
                         THEN EXCLUDED.manifest_jsonb
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.manifest_jsonb
                       ELSE r.manifest_jsonb
                     END,
    schema_version = GREATEST(r.schema_version, EXCLUDED.schema_version),
    updated_at_ts  = public.hlc_max(
                       public.hlc_max(r.updated_at_ts, EXCLUDED.updated_at_ts),
                       public.crdt_compute_updated_at(
                         public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
                         public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                       )
                     ),
    modified_at    = now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crdt_merge_replica(uuid, text, text, jsonb, jsonb, text, text, text, integer) TO authenticated;

-- Migration 008: RPC helpers for the replica_keys table.
-- The bytea salt round-trips as base64 over PostgREST so the client never
-- has to deal with Postgres hex encoding. Both functions run SECURITY
-- INVOKER, so the table's RLS policies (created in migration 003) enforce
-- the auth.uid() = user_id guard.

-- gen_random_bytes() lives in pgcrypto; Supabase enables it by default,
-- but we make the dependency explicit so a fresh self-hosted database
-- works on first apply.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.replica_keys_create(p_alg text)
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_salt_id text := gen_random_uuid()::text;
  v_salt bytea := extensions.gen_random_bytes(32);
BEGIN
  IF p_alg <> 'pbkdf2-600k-sha256' THEN
    RAISE EXCEPTION 'Unsupported alg: %', p_alg USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.replica_keys (user_id, salt_id, alg, salt)
  VALUES (auth.uid(), v_salt_id, p_alg, v_salt);
  RETURN QUERY
    SELECT v_salt_id, p_alg, encode(v_salt, 'base64'), now();
END;
$$;

CREATE OR REPLACE FUNCTION public.replica_keys_list()
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT salt_id, alg, encode(salt, 'base64') AS salt_b64, created_at
  FROM public.replica_keys
  WHERE user_id = (SELECT auth.uid())
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_create(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replica_keys_list() TO authenticated;

-- Migration 010: replica_keys_forget RPC.
-- Wipes every encrypted-field envelope from the user's replica rows
-- (any field whose `v` slot contains a cipher envelope, identified by
-- the `alg` key) and deletes every replica_keys row for the user. The
-- next encrypted push from any device will mint a fresh salt + key.
--
-- Plaintext fields are untouched. Local plaintext copies on each
-- device survive — the user just has to re-enter their sync passphrase
-- on each device and the encrypted fields will be re-encrypted under
-- the new key on the next push.
--
-- SECURITY INVOKER: RLS on replicas + replica_keys gates the writes
-- to the calling user's rows.

CREATE OR REPLACE FUNCTION public.replica_keys_forget()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'replica_keys_forget called without an authenticated user';
  END IF;

  -- Strip cipher envelopes from each row's fields_jsonb. A cipher
  -- envelope is the value of a field's `v` slot when that value is an
  -- object containing the `alg` key (per CipherEnvelope shape:
  -- {c, i, s, alg, h}). Plain field envelopes have a non-object `v`.
  UPDATE public.replicas r
  SET fields_jsonb = (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(r.fields_jsonb)
    WHERE NOT (
      jsonb_typeof(value -> 'v') = 'object'
      AND value -> 'v' ? 'alg'
    )
  )
  WHERE r.user_id = v_user_id
    AND EXISTS (
      SELECT 1 FROM jsonb_each(r.fields_jsonb) e
      WHERE jsonb_typeof(e.value -> 'v') = 'object'
        AND e.value -> 'v' ? 'alg'
    );

  -- Drop every salt row. The next encrypted push will create a fresh
  -- one via replica_keys_create.
  DELETE FROM public.replica_keys WHERE user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_forget() TO authenticated;
