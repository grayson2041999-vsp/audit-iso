import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  presignUpload, buildObjectKey, isR2Configured,
  ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES,
} from '@/lib/r2';
import { resolveActor } from '@/lib/actor';

export const runtime = 'nodejs';

/**
 * Cấp "giấy phép tạm" để trình duyệt PUT thẳng ảnh lên R2, không đi qua server
 * (nhờ vậy server không phải gánh băng thông ảnh — thiết kế này giữ nguyên).
 *
 * TRƯỚC ĐÂY QUẦY PHÁT GIẤY PHÉP KHÔNG HỎI AI LÀ AI: chỉ kiểm tra R2 đã cấu hình
 * chưa rồi ký. Ai biết địa chỉ route cũng xin được quyền ghi vào bucket, tức là
 * bucket thành kho lưu trữ miễn phí cho người lạ.
 *
 * Nguyên tắc phải nhớ khi sửa file này:
 *
 *   R2 CHỈ ÉP ĐƯỢC NHỮNG GÌ NẰM TRONG CHỮ KÝ.
 *
 * `contentType` và `contentLength` đi vào `PutObjectCommand` nên trở thành ràng
 * buộc thật. Mọi kiểm tra khác ở đây chỉ để báo lỗi sớm cho người dùng thật —
 * không phải hàng rào chống người cố tình.
 */

const bodySchema = z.object({
  /**
   * BẮT BUỘC — dùng để xác thực, không phải để ghi dữ liệu. Cookie của đánh giá
   * viên đặt riêng theo từng đợt (`am_<auditId>`) nên phải biết đợt nào mới tra
   * được đúng cookie. Xem `lib/actor.ts`.
   */
  auditId: z.string().uuid('Thiếu mã đợt đánh giá'),
  files: z
    .array(
      z.object({
        fileName: z.string().min(1),
        contentType: z.string(),
        /**
         * Số byte THẬT của file sắp gửi. Trước đây đây chỉ là con số tham khảo
         * (khai gì cũng được, không ai đối chiếu); giờ nó đi thẳng vào chữ ký
         * nên khai sai là R2 từ chối lúc PUT.
         */
        size: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(10),
});

export async function POST(req: Request) {
  if (!isR2Configured()) {
    return NextResponse.json(
      { error: 'Chưa cấu hình Cloudflare R2 (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).' },
      { status: 503 },
    );
  }

  /* --- Cửa 1: dữ liệu hợp lệ --- */
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dữ liệu không hợp lệ', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { auditId, files } = parsed.data;

  /* --- Cửa 2: anh là ai --- */
  const actor = await resolveActor(auditId);
  if (!actor) {
    return NextResponse.json(
      { error: 'Chưa đăng nhập vào đợt đánh giá. Vui lòng mở lại link đợt và nhập mã.' },
      { status: 401 },
    );
  }

  /* --- Cửa 3: đợt còn mở --- */
  if (actor.auditClosed) {
    return NextResponse.json({ error: 'Đợt đã khoá, không tải thêm ảnh được.' }, { status: 409 });
  }

  /* --- Cửa 4: file trông hợp lệ (báo lỗi sớm; hàng rào thật là chữ ký) --- */
  for (const f of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.contentType)) {
      return NextResponse.json({ error: `Định dạng không được hỗ trợ: ${f.contentType}` }, { status: 400 });
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `Ảnh "${f.fileName}" vượt quá 10 MB.` }, { status: 400 });
    }
  }

  const uploads = await Promise.all(
    files.map(async (f) => {
      const key = buildObjectKey(auditId, actor.id, f.fileName);
      const uploadUrl = await presignUpload(key, f.contentType, f.size);
      return { key, uploadUrl, fileName: f.fileName, contentType: f.contentType, size: f.size };
    }),
  );

  return NextResponse.json({ uploads });
}
