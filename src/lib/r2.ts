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

/**
 * Sinh object key: audits/<auditId>/<uploaderId>/<uuid>.<ext>
 *
 * Format cũ là `findings/<yyyy>/<mm>/<uuid>.<ext>` — nhìn tên object không biết
 * nó thuộc đợt nào, ai tải lên. Hệ quả là không dọn được rác: auditor chọn ảnh
 * rồi bỏ dở không lưu finding thì ảnh nằm lại trên R2 vĩnh viễn, và xoá cả một
 * đợt cũng không xoá được ảnh của đợt đó.
 *
 * Có tiền tố định danh thì làm được hai việc:
 *   · Xoá đợt  → xoá theo tiền tố `audits/<auditId>/`
 *   · Dọn rác  → liệt kê key trong bucket, đối chiếu bảng `finding_images`,
 *                cái nào không khớp và cũ hơn vài ngày thì bỏ
 *
 * Chỉ tới được mức `uploaderId` chứ không phải `findingId`: lúc xin presign thì
 * finding CHƯA tồn tại — ảnh lên trước, bản ghi lưu sau.
 *
 * Ảnh cũ giữ nguyên key cũ và vẫn đọc được bình thường, vì mỗi dòng
 * `finding_images` tự lưu key của nó. Không cần migration.
 */
export function buildObjectKey(auditId: string, uploaderId: string, fileName: string) {
  const ext = (fileName.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `audits/${auditId}/${uploaderId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * URL presigned để trình duyệt PUT thẳng file lên R2 (không qua server).
 *
 * `contentLength` PHẢI được truyền vào và PHẢI đúng bằng số byte trình duyệt
 * sắp gửi. Lý do: R2 chỉ ép được những gì nằm TRONG chữ ký. Trước đây route
 * kiểm tra dung lượng bằng con số người gọi tự khai trong JSON — kiểm ở
 * JavaScript rồi ký một tờ giấy phép không nhắc gì tới dung lượng, nên khai
 * 100 byte xong PUT lên 5 GB vẫn trót lọt. Đưa vào đây thì chính R2 từ chối.
 *
 * ⚠️ Nếu sau này thêm bước xử lý ảnh phía trình duyệt (nén, xoay, cắt), phải
 * làm XONG rồi mới xin presign — đổi file sau khi ký là lệch số byte và R2 sẽ
 * trả 403 với thông báo khá tối nghĩa.
 */
export async function presignUpload(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn = 600,
) {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
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
