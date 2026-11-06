import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { capaActions, findings } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { needsCapa } from '@/lib/capa';
import { toRow } from '../shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Tạo sẵn một mục cho mỗi sự không phù hợp (Major / Minor NC) chưa có mục nào.
 *
 * Nội dung điền tạm bằng tiêu đề finding, thời hạn lấy theo thời hạn khắc phục
 * của finding — trưởng đoàn sửa lại thành việc cụ thể sau. Bấm lại nhiều lần
 * cũng không tạo trùng.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const [all, existing] = await Promise.all([
    db.select().from(findings).where(eq(findings.auditId, id)),
    db.select({ findingId: capaActions.findingId }).from(capaActions).where(eq(capaActions.auditId, id)),
  ]);
  const has = new Set(existing.map((e) => e.findingId));
  const targets = all.filter((f) => needsCapa(f.severity) && !has.has(f.id));
  if (targets.length === 0) return NextResponse.json({ ok: true, items: [] });

  const dayOf = (d: Date | null) =>
    d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d) : null;

  try {
    const rows = await db
      .insert(capaActions)
      .values(
        targets.map((f) => ({
          auditId: id,
          findingId: f.id,
          content: (f.title || f.rawText || 'Khắc phục sự không phù hợp').slice(0, 4000),
          dueDate: dayOf(f.dueDate),
        })),
      )
      .returning();
    return NextResponse.json({ ok: true, items: rows.map(toRow) });
  } catch (e) {
    console.error('[khac-phuc:tao-nhanh]', e);
    return NextResponse.json({ error: 'Không tạo được các mục khắc phục.' }, { status: 500 });
  }
}
