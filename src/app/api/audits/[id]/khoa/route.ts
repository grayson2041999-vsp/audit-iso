import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditEvents, audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  closed: z.boolean(),
  /** Ghi chú tuỳ chọn, lưu vào nhật ký đợt. */
  reason: z.string().trim().optional(),
});

/**
 * Khoá đợt hoặc mở lại. Mỗi lần đều ghi một dòng vào `audit_events`.
 * Mở lại trả về "Đang thực hiện" chứ không về "Đang chuẩn bị" — mã đã cấp rồi,
 * quay lại bước chuẩn bị sẽ làm đánh giá viên không vào được.
 *
 * Khoá đợt chỉ khoá việc ghi nhận và sửa finding, chương trình. Phần theo dõi
 * khắc phục vẫn cập nhật được — đó là việc diễn ra SAU khi đợt đã kết thúc.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const { closed } = parsed.data;
  const reason = parsed.data.reason?.trim() ?? '';

  try {
    await db
      .update(audits)
      .set({
        status: closed ? 'CLOSED' : 'IN_PROGRESS',
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));

    await db.insert(auditEvents).values({
      auditId: id,
      actor: owned.leader.fullName,
      action: closed ? 'LOCK' : 'UNLOCK',
      note: reason || null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[audit:khoa]', e);
    return NextResponse.json({ error: 'Không đổi được trạng thái đợt.' }, { status: 500 });
  }
}
