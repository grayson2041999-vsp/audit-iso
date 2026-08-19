import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditUnits, audits } from '@/lib/schema';
import { startUnitSession } from '@/lib/unit-auth';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  unitId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{8}$/, 'Mã gồm đúng 8 chữ số'),
});

/**
 * Đơn vị được đánh giá vào xem báo cáo bằng mã 8 số.
 *
 * KHÔNG có khoá thử sai — quyết định đã chốt: phạm vi nội bộ, không yêu cầu
 * bảo mật cao. Ghi lại ở đây để người đọc code sau không tưởng là sơ suất; nếu
 * đưa vào dùng với dữ liệu nhạy cảm thì đây là chỗ sửa đầu tiên (thêm cột
 * `failed_attempts` + `locked_until` trên `audit_units`).
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  try {
    const [audit] = await db.select().from(audits).where(eq(audits.id, id));
    if (!audit) return NextResponse.json({ error: 'Không tìm thấy đợt đánh giá.' }, { status: 404 });
    if (!audit.issuedAt) {
      return NextResponse.json(
        { error: 'Báo cáo của đợt này chưa được phát hành.' },
        { status: 409 },
      );
    }

    const [unit] = await db
      .select()
      .from(auditUnits)
      .where(and(eq(auditUnits.id, parsed.data.unitId), eq(auditUnits.auditId, id)));

    if (!unit || !unit.accessCode || unit.accessCode !== parsed.data.code) {
      return NextResponse.json({ error: 'Mã không đúng.' }, { status: 401 });
    }

    await startUnitSession(id, unit.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[bao-cao:vao]', e);
    return NextResponse.json({ error: 'Không vào được báo cáo.' }, { status: 500 });
  }
}
