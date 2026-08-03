import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditMembers } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; memberId: string }> };

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
      { error: 'Không xoá được — có thể đánh giá viên này đã ghi nhận finding.' },
      { status: 500 },
    );
  }
}
