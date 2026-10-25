import { s3Storage, getBucketName } from './s3';

/**
 * Whether a client-supplied `fileName` is safe to interpolate into a storage
 * object key (`${userId}/${fileName}`). URL parsers collapse `../` segments
 * before a request is signed, so an unsanitized name can escape the caller's
 * `${userId}/` prefix and write into another tenant's namespace
 * (GHSA-mfmj-2frf-vhgw).
 *
 * Legitimate names DO contain `/` (e.g. `Cognoscimus/Books/<hash>.epub`,
 * `Cognoscimus/Replicas/<kind>/<id>/<file>`), so we reject traversal rather than
 * separators: no `.`/`..`/empty path segments, no leading slash (absolute), no
 * backslash or NUL, checked on both the raw and percent-decoded forms.
 */
export const isSafeObjectKeyName = (fileName: string): boolean => {
  if (typeof fileName !== 'string' || fileName.length === 0) return false;

  const forms = [fileName];
  try {
    const decoded = decodeURIComponent(fileName);
    if (decoded !== fileName) forms.push(decoded);
  } catch {
    return false; // malformed percent-encoding
  }

  for (const form of forms) {
    if (form.includes('\\') || form.includes('\0')) return false;
    if (form.startsWith('/')) return false;
    if (form.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  }
  return true;
};

export const getDownloadSignedUrl = async (fileKey: string, expiresIn: number) =>
  s3Storage.getDownloadSignedUrl(getBucketName(), fileKey, expiresIn);

export const getUploadSignedUrl = async (
  fileKey: string,
  contentLength: number,
  expiresIn: number,
) => s3Storage.getUploadSignedUrl(getBucketName(), fileKey, contentLength, expiresIn);

export const putObject = async (fileKey: string, body: ArrayBuffer | string, contentType: string) =>
  s3Storage.putObject(getBucketName(), fileKey, body, contentType);

export const deleteObject = async (fileKey: string) =>
  s3Storage.deleteObject(getBucketName(), fileKey);

// Returns true if the object exists in storage. Used to verify uploads completed
// before treating a `files` row as shareable.
export const objectExists = async (fileKey: string): Promise<boolean> => {
  try {
    await s3Storage.headObject(getBucketName(), fileKey);
    return true;
  } catch {
    return false;
  }
};

// Server-side byte copy, used to clone a shared book into the recipient's
// namespace without egress.
export const copyObject = async (sourceFileKey: string, destFileKey: string) =>
  s3Storage.copyObject(getBucketName(), sourceFileKey, destFileKey);
