import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { findingImages, findingRevisions, findings } from '@/lib/schema';
import { clauseRefSchema, severitySchema } from '@/lib/types';
import { getOwnedAudit } from '@/lib/audit-access';
import { deleteObject, isR2Configured } from '@/lib/r2';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; fid: string }> };

const patchSchema = z.object({
  title: z.string().optional(),
  severity: severitySchema.optional(),
  statement: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  clauses: z.array(clauseRefSchema).optional(),
  rawArea: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'REVIEWED', 'CLOSED']).optional(),
});

/** Trưởng đoàn sửa được finding của bất kỳ đánh giá viên nào trong đợt của mình. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, fid } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json(
      { error: 'Đợt đã khoá. Mở lại đợt trước khi chỉnh sửa.' },
      { status: 409 },
    );
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }

  const [before] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.id, fid), eq(findings.auditId, id)));
  if (!before) return NextResponse.json({ error: 'Không tìm thấy finding.' }, { status: 404 });

  const { dueDate, ...rest } = parsed.data;

  try {
    await db.insert(findingRevisions).values({
      findingId: fid,
      editor: owned.leader.fullName,
      note: 'Trưởng đoàn chỉnh sửa',
      snapshot: before,
    });

    const [row] = await db
      .update(findings)
      .set({
        ...rest,
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(findings.id, fid))
      .returning();

    return NextResponse.json({ finding: row });
  } catch (e) {
    console.error('[leader:finding:PATCH]', e);
    return NextResponse.json({ error: 'Không cập nhật được finding.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, fid } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá.' }, { status: 409 });
  }

  try {
    const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, fid));
    if (isR2Configured()) await Promise.allSettled(imgs.map((i) => deleteObject(i.key)));
    await db.delete(findings).where(and(eq(findings.id, fid), eq(findings.auditId, id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[leader:finding:DELETE]', e);
    return NextResponse.json({ error: 'Không xoá được finding.' }, { status: 500 });
  }
}
