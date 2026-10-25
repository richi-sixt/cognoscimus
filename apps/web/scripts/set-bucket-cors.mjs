// One-off: allow the browser to upload to and download from the book bucket
// directly (presigned URLs are cross-origin requests).
//
//   pnpm --filter @cognoscimus/web storage:cors
//   S3_CORS_ORIGINS=http://localhost:3000,https://app.example.org pnpm --filter @cognoscimus/web storage:cors
//
// Reads S3_* from the environment (.env.local is loaded by the package script).
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET_NAME'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment: ${missing.join(', ')}`);
  process.exit(1);
}

const origins = (process.env.S3_CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const client = new S3Client({
  forcePathStyle: true,
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const Bucket = process.env.S3_BUCKET_NAME;

await client.send(
  new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

const { CORSRules } = await client.send(new GetBucketCorsCommand({ Bucket }));
console.log(`CORS set on bucket "${Bucket}" for: ${origins.join(', ')}`);
console.log(JSON.stringify(CORSRules, null, 2));
