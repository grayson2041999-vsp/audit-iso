import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits, audits, findingImages, findings } from '@/lib/schema';
import { createFindingSchema } from '@/lib/types';
import { getMember, memberOwnsUnit } from '@/lib/member-auth';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sinh mã finding bằng bộ đếm nguyên tử trên bản ghi đợt.
 * Một câu UPDATE ... RETURNING nên hai người lưu cùng lúc không nhận trùng số.
 */
async function nextFindingCode(auditId: string) {
  const [row] = await db
    .update(audits)
    .set({ findingSeq: sql`${audits.findingSeq} + 1` })
    .where(eq(audits.id, auditId))
    .returning({ seq: audits.findingSeq });
  return `F-${String(row.seq).padStart(2, '0')}`;
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const session = await getMember(id);
  if (!session) return NextResponse.json({ error: 'Chưa đăng nhập vào đợt.' }, { status: 401 });
  if (session.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không ghi nhận thêm được.' }, { status: 409 });
  }

  const body = await req.json();
  const parsed = createFindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  const unitId: string | undefined = body.unitId;
  if (!unitId || !(await memberOwnsUnit(id, session.member.id, unitId))) {
    return NextResponse.json(
      { error: 'Bạn không được phân công đánh giá đơn vị này.' },
      { status: 403 },
    );
  }

  const [unit] = await db.select().from(auditUnits).where(eq(auditUnits.id, unitId));
  const d = parsed.data;
  const ai = d.ai;

  try {
    const code = await nextFindingCode(id);

    const [row] = await db
      .insert(findings)
      .values({
        auditId: id,
        unitId,
        memberId: session.member.id,
        code,
        status: 'DRAFT',
        rawText: d.rawText,
        rawArea: d.area ?? null,
        // Bản chụp tên tại thời điểm ghi nhận — báo cáo cũ vẫn đọc được
        // kể cả khi đơn vị đổi tên hoặc đánh giá viên bị xoá khỏi đợt.
        auditee: unit?.name ?? null,
        auditorName: session.member.fullName,
        observedAt: d.observedAt ? new Date(d.observedAt) : new Date(),
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        standards: d.standards,
        title: ai?.title ?? null,
        severity: ai?.severity ?? null,
        evidence: ai?.evidence ?? [],
        statement: ai?.statement ?? null,
        clauses:
          ai?.clauses.map((c) => ({
            standard: c.standard, clause: c.clause, clauseTitle: c.clauseTitle,
          })) ?? [],
        missingInfo: ai?.missingInfo ?? [],
        aiModel: ai ? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5' : null,
        aiRaw: ai ?? null,
      })
      .returning();

    if (d.images.length) {
      await db.insert(findingImages).values(
        d.images.map((img, i) => ({
          findingId: row.id,
          key: img.key,
          fileName: img.fileName ?? null,
          contentType: img.contentType ?? null,
          size: img.size ?? null,
          caption: ai?.imageNotes?.[i] ?? null,
        })),
      );
    }

    return NextResponse.json({ finding: row }, { status: 201 });
  } catch (e) {
    console.error('[dot:findings:POST]', e);
    return NextResponse.json({ error: 'Không lưu được finding.' }, { status: 500 });
  }
}
