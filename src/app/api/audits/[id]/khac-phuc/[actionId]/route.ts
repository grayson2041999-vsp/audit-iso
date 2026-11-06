import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { capaActions } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { todayVN } from '@/lib/capa';
import { capaFields, toRow } from '../shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; actionId: string }> };

const schema = z.object({ ...capaFields, content: capaFields.content.optional() });

/**
 * Sửa một mục. Gửi trường nào thì đổi trường đó — đổi nhanh trạng thái ngay
 * trên danh sách chỉ gửi `status`.
 *
 * Chuyển sang Hoàn thành mà chưa có ngày hoàn thành thì lấy hôm nay; rời khỏi
 * Hoàn thành thì xoá ngày hoàn thành, để con số không nói dối.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, actionId } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const d = parsed.data;

  const [current] = await db
    .select()
    .from(capaActions)
    .where(and(eq(capaActions.id, actionId), eq(capaActions.auditId, id)));
  if (!current) return NextResponse.json({ error: 'Không tìm thấy mục khắc phục.' }, { status: 404 });

  const status = d.status ?? current.status;
  let completedDate = d.completedDate !== undefined ? d.completedDate : current.completedDate;
  if (status === 'DONE' && !completedDate) completedDate = todayVN();
  if (status !== 'DONE') completedDate = null;

  try {
    const [row] = await db
      .update(capaActions)
      .set({
        ...(d.content !== undefined ? { content: d.content } : {}),
        ...(d.owner !== undefined ? { owner: d.owner || null } : {}),
        ...(d.dueDate !== undefined ? { dueDate: d.dueDate } : {}),
        ...(d.note !== undefined ? { note: d.note || null } : {}),
        status,
        completedDate,
        updatedAt: new Date(),
      })
      .where(eq(capaActions.id, actionId))
      .returning();
    return NextResponse.json({ ok: true, item: toRow(row) });
  } catch (e) {
    console.error('[khac-phuc:PATCH]', e);
    return NextResponse.json({ error: 'Không lưu được thay đổi.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, actionId } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  try {
    await db.delete(capaActions).where(and(eq(capaActions.id, actionId), eq(capaActions.auditId, id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[khac-phuc:DELETE]', e);
    return NextResponse.json({ error: 'Không xoá được mục khắc phục.' }, { status: 500 });
  }
}
