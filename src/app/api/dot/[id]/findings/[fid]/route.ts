import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { findingImages, findingRevisions, findings } from '@/lib/schema';
import { clauseRefSchema, severitySchema } from '@/lib/types';
import { getMember } from '@/lib/member-auth';
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
  /** Bấm "Nộp" — sau đó đánh giá viên hết quyền sửa. */
  submit: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, fid } = await params;

  const session = await getMember(id);
  if (!session) return NextResponse.json({ error: 'Chưa đăng nhập vào đợt.' }, { status: 401 });
  if (session.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá.' }, { status: 409 });
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
  if (before.memberId !== session.member.id) {
    return NextResponse.json({ error: 'Đây không phải finding của bạn.' }, { status: 403 });
  }
  if (before.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Finding đã nộp, chỉ trưởng đoàn sửa được.' },
      { status: 409 },
    );
  }

  const { submit, dueDate, ...rest } = parsed.data;

  try {
    await db.insert(findingRevisions).values({
      findingId: fid,
      editor: session.member.fullName,
      note: submit ? 'Nộp finding' : 'Đánh giá viên chỉnh sửa',
      snapshot: before,
    });

    const [row] = await db
      .update(findings)
      .set({
        ...rest,
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(submit ? { status: 'SUBMITTED' as const, submittedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(findings.id, fid))
      .returning();

    return NextResponse.json({ finding: row });
  } catch (e) {
    console.error('[dot:finding:PATCH]', e);
    return NextResponse.json({ error: 'Không cập nhật được finding.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, fid } = await params;

  const session = await getMember(id);
  if (!session) return NextResponse.json({ error: 'Chưa đăng nhập vào đợt.' }, { status: 401 });

  const [row] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.id, fid), eq(findings.auditId, id)));

  if (!row) return NextResponse.json({ error: 'Không tìm thấy finding.' }, { status: 404 });
  if (row.memberId !== session.member.id) {
    return NextResponse.json({ error: 'Đây không phải finding của bạn.' }, { status: 403 });
  }
  if (row.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Finding đã nộp, không xoá được.' }, { status: 409 });
  }

  try {
    const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, fid));
    if (isR2Configured()) await Promise.allSettled(imgs.map((i) => deleteObject(i.key)));
    await db.delete(findings).where(eq(findings.id, fid));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[dot:finding:DELETE]', e);
    return NextResponse.json({ error: 'Không xoá được finding.' }, { status: 500 });
  }
}
