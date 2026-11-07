import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { sameUnitName } from '@/lib/utils';

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
 * Trưởng đoàn tick thoải mái trên màn hình rồi bấm Lưu một lần.
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
      db
        .select({ id: auditUnits.id, name: auditUnits.name })
        .from(auditUnits)
        .where(eq(auditUnits.auditId, id)),
      db
        .select({ id: auditMembers.id, fullName: auditMembers.fullName, homeUnit: auditMembers.homeUnit })
        .from(auditMembers)
        .where(eq(auditMembers.auditId, id)),
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

    // Không ai được đánh giá chính đơn vị mình (theo ô đơn vị công tác).
    const unitById = new Map(units.map((u) => [u.id, u]));
    const memberById = new Map(members.map((m) => [m.id, m]));
    const selfAudits = [...wanted].flatMap((k) => {
      const [memberId, unitId] = k.split(':');
      const m = memberById.get(memberId)!;
      const u = unitById.get(unitId)!;
      return sameUnitName(m.homeUnit, u.name) ? [`${m.fullName} (${u.name})`] : [];
    });
    if (selfAudits.length > 0) {
      return NextResponse.json(
        {
          error:
            `Không thể phân công đánh giá viên đánh giá chính đơn vị mình: ${selfAudits.join(', ')}. ` +
            'Bỏ tick các ô này rồi lưu lại.',
        },
        { status: 400 },
      );
    }

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
