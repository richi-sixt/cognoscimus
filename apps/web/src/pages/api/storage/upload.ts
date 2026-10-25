import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import {
  getStoragePlanData,
  validateUserAndToken,
  STORAGE_QUOTA_GRACE_BYTES,
} from '@/utils/access';
import { getUploadSignedUrl, isSafeObjectKeyName } from '@/utils/object';

const isValidFileSize = (size: unknown): size is number =>
  Number.isSafeInteger(size) && (size as number) > 0;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  if (!user || !token) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const { fileName, fileSize, bookHash, replicaKind, replicaId } = req.body;

  // Reject object-key path traversal before building any key. `fileName` is
  // fully client-controlled and is interpolated into `${user.id}/${fileName}`;
  // without this an attacker escapes their own prefix into another user's
  // namespace (GHSA-mfmj-2frf-vhgw).
  if (!isSafeObjectKeyName(fileName)) {
    return res.status(400).json({ error: 'Invalid fileName' });
  }

  if (!isValidFileSize(fileSize)) {
    return res.status(400).json({ error: 'Invalid fileSize' });
  }

  try {
    const { quota } = getStoragePlanData(token);
    const fileKey = `${user.id}/${fileName}`;
    const supabase = createSupabaseAdminClient();
    const { data: existingRecord, error: fetchError } = await supabase
      .from('files')
      .select('file_size')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });

    // A re-upload is signed with the recorded size and adds nothing to usage.
    // A new file's row is its reservation: insert it first, then check the
    // quota against the sum of all live rows, which includes this upload and
    // every one committed before it. Checking before the insert let concurrent
    // requests all pass against the same usage.
    let objSize = fileSize;
    let insertedId: string | null = null;
    if (existingRecord) {
      objSize = existingRecord.file_size;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('files')
        .insert([
          {
            user_id: user.id,
            book_hash: bookHash ?? null,
            replica_kind: replicaKind ?? null,
            replica_id: replicaId ?? null,
            file_key: fileKey,
            file_size: fileSize,
          },
        ])
        .select('id')
        .single();
      if (insertError) return res.status(500).json({ error: insertError.message });
      insertedId = inserted.id;
    }

    const dropReservation = async () => {
      if (insertedId) await supabase.from('files').delete().eq('id', insertedId);
    };

    const { data: usageBytes, error: usageError } = await supabase.rpc('storage_usage_bytes', {
      p_user_id: user.id,
    });
    if (usageError) {
      await dropReservation();
      return res.status(500).json({ error: 'Could not read storage usage' });
    }
    const usage = Number(usageBytes ?? 0);

    if (insertedId && usage > quota + STORAGE_QUOTA_GRACE_BYTES) {
      await dropReservation();
      return res.status(403).json({ error: 'Insufficient storage quota', usage: usage - fileSize });
    }

    try {
      const uploadUrl = await getUploadSignedUrl(fileKey, objSize, 1800);

      res.status(200).json({ uploadUrl, fileKey, usage, quota });
    } catch (error) {
      console.error('Error creating presigned post:', error);
      // Don't leave a row behind for an upload that can never happen.
      await dropReservation();
      res.status(500).json({ error: 'Could not create presigned post' });
    }
  } catch (error) {
    console.error('Error processing upload request:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
}
