import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; unitId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, unitId } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  try {
    // Phân công liên quan tự xoá theo (ON DELETE CASCADE).
    await db.delete(auditUnits).where(and(eq(auditUnits.id, unitId), eq(auditUnits.auditId, id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[units:DELETE]', e);
    return NextResponse.json(
      { error: 'Không xoá được — có thể đơn vị này đã có finding.' },
      { status: 500 },
    );
  }
}
