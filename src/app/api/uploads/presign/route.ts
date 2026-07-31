import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  presignUpload, buildObjectKey, isR2Configured,
  ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES,
} from '@/lib/r2';

export const runtime = 'nodejs';

const bodySchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().min(1),
        contentType: z.string(),
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

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ', issues: parsed.error.issues }, { status: 400 });
  }

  for (const f of parsed.data.files) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.contentType)) {
      return NextResponse.json({ error: `Định dạng không được hỗ trợ: ${f.contentType}` }, { status: 400 });
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `Ảnh "${f.fileName}" vượt quá 10 MB.` }, { status: 400 });
    }
  }

  const uploads = await Promise.all(
    parsed.data.files.map(async (f) => {
      const key = buildObjectKey(f.fileName);
      const uploadUrl = await presignUpload(key, f.contentType);
      return { key, uploadUrl, fileName: f.fileName, contentType: f.contentType, size: f.size };
    }),
  );

  return NextResponse.json({ uploads });
}
