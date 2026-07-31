import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.R2_ACCOUNT_ID ?? '';
export const R2_BUCKET = process.env.R2_BUCKET ?? 'audit-findings';
const publicBase = process.env.R2_PUBLIC_BASE_URL ?? '';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

/** Sinh object key an toàn: findings/<yyyy>/<mm>/<uuid>.<ext> */
export function buildObjectKey(fileName: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const ext = (fileName.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `findings/${y}/${m}/${crypto.randomUUID()}.${ext}`;
}

/** URL presigned để trình duyệt PUT thẳng file lên R2 (không qua server). */
export async function presignUpload(key: string, contentType: string, expiresIn = 600) {
  const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(r2, cmd, { expiresIn });
}

/** URL presigned để xem ảnh (dùng khi bucket private). */
export async function presignDownload(key: string, expiresIn = 3600) {
  if (publicBase) return `${publicBase.replace(/\/$/, '')}/${key}`;
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn });
}

/** Tải object về dạng base64 để đưa vào Claude vision. */
export async function getObjectBase64(key: string) {
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return {
    base64: Buffer.from(bytes).toString('base64'),
    contentType: res.ContentType ?? 'image/jpeg',
  };
}

export async function deleteObject(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
