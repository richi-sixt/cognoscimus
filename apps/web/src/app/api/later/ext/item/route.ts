import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateLater } from '@/libs/later/extensionAuth';
import { readLabelNames, readNote } from '@/libs/later/extensionInput';
import { isUuid } from '@/libs/grantsServer';

interface Body {
  id?: unknown;
  note?: unknown;
  collectionId?: unknown;
  labels?: unknown;
}

const invalid = (error: string, code: string) =>
  NextResponse.json({ error, code }, { status: 400 });

// POST /api/later/ext/item — sets the note, the collection and the labels of a
// saved item from the browser extension. A field that is left out stays as it
// is. Labels are given by name; ones that do not exist yet are created.
export async function POST(request: Request) {
  const who = await authenticateLater(request);
  if (!who) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isUuid(body.id)) return invalid('Missing or invalid id', 'invalid_id');

  const update: { note?: string | null; collection_id?: string | null } = {};
  if (body.note !== undefined) {
    const note = readNote(body.note);
    if (note === undefined) return invalid('Invalid note', 'invalid_note');
    update.note = note;
  }
  if (body.collectionId !== undefined) {
    if (body.collectionId !== null && !isUuid(body.collectionId)) {
      return invalid('Invalid collectionId', 'invalid_collection');
    }
    update.collection_id = body.collectionId;
  }
  const names = body.labels === undefined ? undefined : readLabelNames(body.labels);
  if (names === null) return invalid('Invalid labels', 'invalid_labels');

  const supabase = createSupabaseAdminClient();
  try {
    // The service role bypasses row security, so ownership is checked here.
    const { data: item, error: itemError } = await supabase
      .from('later_items')
      .select('id')
      .eq('id', body.id)
      .eq('user_id', who.userId)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    if (update.collection_id) {
      const { data: collection, error } = await supabase
        .from('later_collections')
        .select('id')
        .eq('id', update.collection_id)
        .eq('user_id', who.userId)
        .maybeSingle();
      if (error) throw error;
      if (!collection) {
        return NextResponse.json(
          { error: 'Collection not found', code: 'collection_not_found' },
          { status: 404 },
        );
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from('later_items').update(update).eq('id', item.id);
      if (error) throw error;
    }

    if (names) {
      const { data: owned, error: ownedError } = await supabase
        .from('later_labels')
        .select('id, name')
        .eq('user_id', who.userId);
      if (ownedError) throw ownedError;
      const byName = new Map((owned ?? []).map((l) => [(l.name as string).toLowerCase(), l.id]));

      const missing = names.filter((name) => !byName.has(name.toLowerCase()));
      if (missing.length > 0) {
        const { data: created, error } = await supabase
          .from('later_labels')
          .insert(missing.map((name) => ({ user_id: who.userId, name })))
          .select('id, name');
        if (error) throw error;
        for (const l of created ?? []) byName.set((l.name as string).toLowerCase(), l.id);
      }
      const wanted = new Set(names.map((name) => byName.get(name.toLowerCase()) as string));

      const { data: links, error: linksError } = await supabase
        .from('later_item_labels')
        .select('label_id')
        .eq('item_id', item.id);
      if (linksError) throw linksError;
      const current = new Set((links ?? []).map((l) => l.label_id as string));

      const add = [...wanted].filter((id) => !current.has(id));
      const remove = [...current].filter((id) => !wanted.has(id));
      if (add.length > 0) {
        const { error } = await supabase
          .from('later_item_labels')
          .insert(add.map((label_id) => ({ item_id: item.id, label_id })));
        if (error) throw error;
      }
      if (remove.length > 0) {
        const { error } = await supabase
          .from('later_item_labels')
          .delete()
          .eq('item_id', item.id)
          .in('label_id', remove);
        if (error) throw error;
      }
    }

    return NextResponse.json({ id: item.id });
  } catch (error) {
    console.error('later ext item failed:', error);
    return NextResponse.json({ error: 'Could not update the item' }, { status: 500 });
  }
}
