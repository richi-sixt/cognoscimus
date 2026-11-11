import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import {
  EXTENSION_TOKENS_MAX,
  extensionTokenOwner,
  hashExtensionToken,
  newExtensionToken,
} from '@/libs/later/extensionAuth';
import { readTokenName } from '@/libs/later/extensionInput';

// POST /api/later/ext/token — connects a browser extension: creates a token
// for the signed-in user and returns it once. Only a session may do this; an
// extension token cannot create further tokens.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { count, error: countError } = await supabase
    .from('later_extension_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (countError) {
    console.error('later ext token count failed:', countError);
    return NextResponse.json({ error: 'Could not connect the extension' }, { status: 500 });
  }
  if ((count ?? 0) >= EXTENSION_TOKENS_MAX) {
    return NextResponse.json(
      { error: 'Too many connected extensions', code: 'too_many' },
      { status: 409 },
    );
  }

  const extensionToken = newExtensionToken();
  const { data, error } = await supabase
    .from('later_extension_tokens')
    .insert({
      user_id: user.id,
      token_hash: hashExtensionToken(extensionToken),
      name: readTokenName(body.name),
    })
    .select('id')
    .single();
  if (error) {
    console.error('later ext token insert failed:', error);
    return NextResponse.json({ error: 'Could not connect the extension' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, token: extensionToken });
}

// DELETE /api/later/ext/token — the extension disconnects itself: the token it
// sends is removed.
export async function DELETE(request: Request) {
  const owner = await extensionTokenOwner(request);
  if (!owner) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { error } = await createSupabaseAdminClient()
    .from('later_extension_tokens')
    .delete()
    .eq('id', owner.tokenId);
  if (error) {
    console.error('later ext token delete failed:', error);
    return NextResponse.json({ error: 'Could not disconnect' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
