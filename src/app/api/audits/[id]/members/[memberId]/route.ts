import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { sameUnitName } from '@/lib/utils';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; memberId: string }> };

const patchSchema = z.object({
  fullName: z.string().trim().min(2, 'Nhập họ tên đánh giá viên'),
  homeUnit: z.string().trim().optional(),
});

/**
 * Sửa họ tên và đơn vị công tác của một đánh giá viên. Mã truy cập giữ nguyên.
 * Finding đã ghi nhận vẫn giữ tên cũ, vì tên trên finding là bản chụp lúc ghi.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, memberId } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { fullName } = parsed.data;
  const homeUnit = parsed.data.homeUnit || null;

  const members = await db.select().from(auditMembers).where(eq(auditMembers.auditId, id));
  const member = members.find((m) => m.id === memberId);
  if (!member) {
    return NextResponse.json({ error: 'Không tìm thấy đánh giá viên.' }, { status: 404 });
  }

  // Trưởng đoàn được nhận ra theo tên tài khoản, đổi tên ở đây là mất liên kết đó.
  const isLeader = member.isLeader === '1' || member.fullName === owned.leader.fullName;
  if (isLeader && fullName !== member.fullName) {
    return NextResponse.json(
      { error: 'Tên trưởng đoàn lấy theo tài khoản đăng nhập, không sửa ở đây được.' },
      { status: 400 },
    );
  }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (members.some((m) => m.id !== memberId && norm(m.fullName) === norm(fullName))) {
    return NextResponse.json(
      { error: 'Đã có đánh giá viên trùng tên. Thêm chức danh hoặc tên đệm để phân biệt.' },
      { status: 409 },
    );
  }

  // Đơn vị công tác mới không được trùng đơn vị người này đang được phân công đánh giá.
  if (homeUnit) {
    const assigned = await db
      .select({ name: auditUnits.name })
      .from(assignments)
      .innerJoin(auditUnits, eq(assignments.unitId, auditUnits.id))
      .where(and(eq(assignments.auditId, id), eq(assignments.memberId, memberId)));
    const clash = assigned.find((u) => sameUnitName(homeUnit, u.name));
    if (clash) {
      return NextResponse.json(
        {
          error:
            `${fullName} đang được phân công đánh giá ${clash.name}. ` +
            'Bỏ tick ô này ở bước 3 và lưu phân công trước, rồi mới đổi đơn vị công tác.',
        },
        { status: 409 },
      );
    }
  }

  try {
    await db
      .update(auditMembers)
      .set({ fullName, homeUnit })
      .where(and(eq(auditMembers.id, memberId), eq(auditMembers.auditId, id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[members:PATCH]', e);
    return NextResponse.json({ error: 'Không lưu được thông tin đánh giá viên.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, memberId } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  try {
    await db
      .delete(auditMembers)
      .where(and(eq(auditMembers.id, memberId), eq(auditMembers.auditId, id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[members:DELETE]', e);
    return NextResponse.json(
      { error: 'Không xoá được. Có thể đánh giá viên này đã ghi nhận finding.' },
      { status: 500 },
    );
  }
}
