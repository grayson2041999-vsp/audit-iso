import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  memberId: z.string().uuid(),
  unitId: z.string().uuid(),
  on: z.boolean(),
});

/** Bật/tắt một ô trong ma trận phân công. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const { memberId, unitId, on } = parsed.data;

  // Cả đánh giá viên lẫn đơn vị đều phải thuộc đúng đợt này.
  const [member] = await db
    .select()
    .from(auditMembers)
    .where(and(eq(auditMembers.id, memberId), eq(auditMembers.auditId, id)));
  const [unit] = await db
    .select()
    .from(auditUnits)
    .where(and(eq(auditUnits.id, unitId), eq(auditUnits.auditId, id)));

  if (!member || !unit) {
    return NextResponse.json({ error: 'Đánh giá viên hoặc đơn vị không thuộc đợt này.' }, { status: 400 });
  }

  try {
    if (on) {
      await db
        .insert(assignments)
        .values({ auditId: id, memberId, unitId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(assignments)
        .where(and(eq(assignments.memberId, memberId), eq(assignments.unitId, unitId)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[assignments:POST]', e);
    return NextResponse.json({ error: 'Không cập nhật được phân công.' }, { status: 500 });
  }
}
