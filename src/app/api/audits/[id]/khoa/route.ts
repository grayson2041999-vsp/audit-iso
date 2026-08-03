import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ closed: z.boolean() });

/**
 * Khoá đợt hoặc mở lại.
 * Mở lại trả về "Đang thực hiện" chứ không về "Đang chuẩn bị" — mã đã cấp rồi,
 * quay lại bước chuẩn bị sẽ làm đánh giá viên không vào được.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }

  try {
    await db
      .update(audits)
      .set({
        status: parsed.data.closed ? 'CLOSED' : 'IN_PROGRESS',
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[audit:khoa]', e);
    return NextResponse.json({ error: 'Không đổi được trạng thái đợt.' }, { status: 500 });
  }
}
