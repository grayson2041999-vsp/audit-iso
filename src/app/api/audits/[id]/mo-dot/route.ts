import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditUnits, audits } from '@/lib/schema';
import { getOwnedAudit, generateAccessCode } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sinh mã 6 số cho toàn bộ đánh giá viên và chuyển đợt sang "Đang thực hiện".
 * Chính hành động này là hành động mở đợt — không có nút bật/tắt riêng.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá.' }, { status: 409 });
  }

  const [units, members, links] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)),
    db.select().from(auditMembers).where(eq(auditMembers.auditId, id)),
    db.select().from(assignments).where(eq(assignments.auditId, id)),
  ]);

  if (units.length === 0) {
    return NextResponse.json({ error: 'Chưa khai báo đơn vị được đánh giá nào.' }, { status: 400 });
  }
  if (members.length === 0) {
    return NextResponse.json({ error: 'Chưa khai báo đánh giá viên nào.' }, { status: 400 });
  }

  // Ràng buộc: mọi đơn vị phải có ít nhất một đánh giá viên.
  const assignedUnitIds = new Set(links.map((l) => l.unitId));
  const orphanUnits = units.filter((u) => !assignedUnitIds.has(u.id));
  if (orphanUnits.length > 0) {
    return NextResponse.json(
      {
        error:
          'Chưa phân công đánh giá viên cho: ' + orphanUnits.map((u) => u.name).join(', '),
      },
      { status: 400 },
    );
  }

  try {
    const taken = new Set(members.map((m) => m.accessCode).filter(Boolean) as string[]);
    // Chỉ cấp mã cho người chưa có — mở lại đợt không làm đổi mã của người cũ.
    const needCode = members.filter((m) => !m.accessCode);

    for (const m of needCode) {
      await db
        .update(auditMembers)
        .set({ accessCode: generateAccessCode(taken) })
        .where(eq(auditMembers.id, m.id));
    }

    await db
      .update(audits)
      .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
      .where(eq(audits.id, id));

    return NextResponse.json({ ok: true, issued: needCode.length });
  } catch (e) {
    console.error('[mo-dot:POST]', e);
    return NextResponse.json({ error: 'Không mở được đợt đánh giá.' }, { status: 500 });
  }
}
