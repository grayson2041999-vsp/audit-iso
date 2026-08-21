import { NextResponse } from 'next/server';
import { Packer } from 'docx';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits, auditUnits } from '@/lib/schema';
import { checklistExportSchema } from '@/lib/types';
import { resolveActor } from '@/lib/actor';
import { memberOwnsUnit } from '@/lib/member-auth';
import { buildChecklistDoc, checklistFileName } from '@/lib/checklist-docx';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; unitId: string }> };

/**
 * Dựng file Word từ các dòng đánh giá viên đã rà soát trên màn hình.
 *
 * Nhận qua POST chứ không phải GET vì máy chủ không giữ checklist ở đâu cả —
 * bản đúng là bản đang nằm trong màn hình của đánh giá viên, kể cả những dòng
 * họ vừa sửa chữ hoặc tự viết thêm. Xem `docs/concept-checklist.md` mục 8.
 *
 * Không có cửa hạn mức AI ở đây: route này không gọi AI, chỉ sắp chữ.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, unitId } = await params;

  const parsed = checklistExportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const actor = await resolveActor(id);
  if (!actor) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  if (actor.kind === 'member' && !(await memberOwnsUnit(id, actor.id, unitId))) {
    return NextResponse.json({ error: 'Không tìm thấy đơn vị.' }, { status: 404 });
  }

  const [[audit], [unit]] = await Promise.all([
    db.select().from(audits).where(eq(audits.id, id)),
    db
      .select()
      .from(auditUnits)
      .where(and(eq(auditUnits.id, unitId), eq(auditUnits.auditId, id))),
  ]);
  if (!audit || !unit) {
    return NextResponse.json({ error: 'Không tìm thấy đơn vị.' }, { status: 404 });
  }

  const doc = buildChecklistDoc({
    organization: audit.organization,
    auditTitle: audit.title,
    unitName: unit.name,
    standards: audit.standards,
    auditorName: actor.name,
    groups: parsed.data.groups,
  });

  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${checklistFileName(unit.name)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
