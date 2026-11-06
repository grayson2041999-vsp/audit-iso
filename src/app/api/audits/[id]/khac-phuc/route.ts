import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { capaActions, findings } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { canHaveCapa, todayVN } from '@/lib/capa';
import { capaFields, toRow } from './shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ findingId: z.string().uuid('Chọn finding'), ...capaFields });

/**
 * Thêm một mục khắc phục cho một finding của đợt.
 *
 * Không chặn khi đợt đã khoá: khoá đợt là chốt finding, còn theo dõi khắc phục
 * chính là việc diễn ra sau đó.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const d = parsed.data;

  const [finding] = await db
    .select({ id: findings.id, severity: findings.severity })
    .from(findings)
    .where(and(eq(findings.id, d.findingId), eq(findings.auditId, id)));
  if (!finding) return NextResponse.json({ error: 'Không tìm thấy finding trong đợt này.' }, { status: 404 });
  if (!canHaveCapa(finding.severity)) {
    return NextResponse.json({ error: 'Finding loại "Phù hợp" không cần khắc phục.' }, { status: 400 });
  }

  const status = d.status ?? 'TODO';
  try {
    const [row] = await db
      .insert(capaActions)
      .values({
        auditId: id,
        findingId: d.findingId,
        content: d.content,
        owner: d.owner || null,
        dueDate: d.dueDate ?? null,
        status,
        completedDate: status === 'DONE' ? d.completedDate ?? todayVN() : null,
        note: d.note || null,
      })
      .returning();
    return NextResponse.json({ ok: true, item: toRow(row) });
  } catch (e) {
    console.error('[khac-phuc:POST]', e);
    return NextResponse.json({ error: 'Không lưu được mục khắc phục.' }, { status: 500 });
  }
}
