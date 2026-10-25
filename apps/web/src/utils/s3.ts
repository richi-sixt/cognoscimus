import { S3Client } from '@aws-sdk/client-s3';
import {
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const S3_ENDPOINT = process.env['S3_ENDPOINT'] || '';
const S3_REGION = process.env['S3_REGION'] || 'auto';
const S3_ACCESS_KEY_ID = process.env['S3_ACCESS_KEY_ID'] || '';
const S3_SECRET_ACCESS_KEY = process.env['S3_SECRET_ACCESS_KEY'] || '';

/** The bucket that holds every user's book files. */
export const getBucketName = (): string => process.env['S3_BUCKET_NAME'] || '';

// Fail with a readable message instead of an opaque SDK/URL error when the
// storage environment is missing.
const assertConfigured = (): void => {
  const missing = [
    ['S3_ENDPOINT', S3_ENDPOINT],
    ['S3_ACCESS_KEY_ID', S3_ACCESS_KEY_ID],
    ['S3_SECRET_ACCESS_KEY', S3_SECRET_ACCESS_KEY],
    ['S3_BUCKET_NAME', getBucketName()],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Object storage is not configured: set ${missing.join(', ')}.`);
  }
};

const s3ClientCredentials = {
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY,
};

// One client for server-side calls and for signing. `forcePathStyle` keeps the
// bucket in the path, which every S3-compatible store accepts. Newer SDK
// versions add CRC32 checksums to every request by default; stores other than
// AWS reject or mis-sign those, so they are only sent when the API requires it.
const createClient = () => {
  assertConfigured();
  return new S3Client({
    forcePathStyle: true,
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    credentials: s3ClientCredentials,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
};

export const s3Storage = {
  getClient: () => createClient(),

  getDownloadSignedUrl: async (bucketName: string, fileKey: string, expiresIn: number) => {
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(createClient(), getCommand, {
      expiresIn: expiresIn,
    });
    return downloadUrl;
  },

  getUploadSignedUrl: async (
    bucketName: string,
    fileKey: string,
    contentLength: number,
    expiresIn: number,
  ) => {
    const signableHeaders = new Set<string>();
    signableHeaders.add('content-length');
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentLength: contentLength,
    });

    const uploadUrl = await getSignedUrl(createClient(), putCommand, {
      expiresIn: expiresIn,
      signableHeaders,
    });

    return uploadUrl;
  },

  putObject: async (
    bucketName: string,
    fileKey: string,
    body: ArrayBuffer | string,
    contentType: string,
  ) => {
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
      ContentType: contentType,
    });
    return await s3Storage.getClient().send(putCommand);
  },

  deleteObject: async (bucketName: string, fileKey: string) => {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    return await s3Storage.getClient().send(deleteCommand);
  },

  headObject: async (bucketName: string, fileKey: string) => {
    const headCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    return await s3Storage.getClient().send(headCommand);
  },

  copyObject: async (
    bucketName: string,
    sourceFileKey: string,
    destFileKey: string,
    sourceBucketName?: string,
  ) => {
    const srcBucket = sourceBucketName || bucketName;
    // S3 requires CopySource to be URL-encoded segment-by-segment. file_key
    // is built from the original filename, so spaces and reserved chars
    // (e.g. `My Book.epub`, `A&B.epub`) are common and would otherwise
    // break the copy.
    const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');
    const copyCommand = new CopyObjectCommand({
      Bucket: bucketName,
      Key: destFileKey,
      CopySource: `${srcBucket}/${encodeKey(sourceFileKey)}`,
    });

    return await s3Storage.getClient().send(copyCommand);
  },
};
