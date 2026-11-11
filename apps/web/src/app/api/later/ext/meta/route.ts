import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateLater } from '@/libs/later/extensionAuth';

// GET /api/later/ext/meta — the collections and labels of the person, for the
// pickers in the browser extension.
export async function GET(request: Request) {
  const who = await authenticateLater(request);
  if (!who) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = createSupabaseAdminClient();
  const [collections, labels] = await Promise.all([
    supabase.from('later_collections').select('id, name, parent_id').eq('user_id', who.userId),
    supabase.from('later_labels').select('id, name').eq('user_id', who.userId).order('name'),
  ]);
  if (collections.error || labels.error) {
    console.error('later ext meta failed:', collections.error ?? labels.error);
    return NextResponse.json({ error: 'Could not load collections' }, { status: 500 });
  }
  return NextResponse.json({ collections: collections.data, labels: labels.data });
}
