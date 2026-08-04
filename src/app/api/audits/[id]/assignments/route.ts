import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const putSchema = z.object({
  pairs: z
    .array(z.object({ memberId: z.string().uuid(), unitId: z.string().uuid() }))
    .max(2000),
});

/**
 * Lưu toàn bộ ma trận phân công trong MỘT lượt.
 *
 * Trước đây mỗi ô tick là một yêu cầu riêng kèm dựng lại cả trang — tick 44 ô
 * là 44 lần chờ. Giờ trưởng đoàn tick thoải mái rồi bấm Lưu một lần.
 *
 * Chỉ ghi phần CHÊNH LỆCH thay vì xoá sạch rồi chèn lại: nếu lệnh chèn hỏng
 * giữa chừng thì phân công cũ vẫn còn nguyên chứ không mất trắng.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }

  try {
    const [units, members, current] = await Promise.all([
      db.select({ id: auditUnits.id }).from(auditUnits).where(eq(auditUnits.auditId, id)),
      db.select({ id: auditMembers.id }).from(auditMembers).where(eq(auditMembers.auditId, id)),
      db.select().from(assignments).where(eq(assignments.auditId, id)),
    ]);

    const unitIds = new Set(units.map((u) => u.id));
    const memberIds = new Set(members.map((m) => m.id));

    // Bỏ qua cặp trỏ tới đơn vị hoặc người không thuộc đợt này.
    const wanted = new Set(
      parsed.data.pairs
        .filter((p) => unitIds.has(p.unitId) && memberIds.has(p.memberId))
        .map((p) => `${p.memberId}:${p.unitId}`),
    );
    const existing = new Map(current.map((a) => [`${a.memberId}:${a.unitId}`, a.id]));

    const toAdd = [...wanted].filter((k) => !existing.has(k));
    const toRemoveIds = [...existing.entries()]
      .filter(([k]) => !wanted.has(k))
      .map(([, rowId]) => rowId);

    if (toAdd.length > 0) {
      await db
        .insert(assignments)
        .values(
          toAdd.map((k) => {
            const [memberId, unitId] = k.split(':');
            return { auditId: id, memberId, unitId };
          }),
        )
        .onConflictDoNothing();
    }

    if (toRemoveIds.length > 0) {
      await db.delete(assignments).where(inArray(assignments.id, toRemoveIds));
    }

    return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemoveIds.length });
  } catch (e) {
    console.error('[assignments:PUT]', e);
    return NextResponse.json({ error: 'Không lưu được phân công.' }, { status: 500 });
  }
}
