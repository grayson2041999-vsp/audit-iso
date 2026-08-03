import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findingImages, findings } from '@/lib/schema';
import { getMember } from '@/lib/member-auth';
import { standardizeFinding, isAiConfigured } from '@/lib/ai';
import type { StandardCode } from '@/lib/iso';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; fid: string }> };

/**
 * Chuẩn hoá một finding đã lưu nháp.
 *
 * Toàn bộ việc gọi AI và ghi kết quả làm ở phía máy chủ trong một lượt, để
 * trình duyệt không phải tự điều phối hai lời gọi rồi lỡ mất kết quả giữa chừng.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id, fid } = await params;

  const session = await getMember(id);
  if (!session) return NextResponse.json({ error: 'Chưa đăng nhập vào đợt.' }, { status: 401 });
  if (session.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá.' }, { status: 409 });
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ error: 'Chưa cấu hình ANTHROPIC_API_KEY.' }, { status: 503 });
  }

  const [row] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.id, fid), eq(findings.auditId, id)));

  if (!row) return NextResponse.json({ error: 'Không tìm thấy finding.' }, { status: 404 });
  if (row.memberId !== session.member.id) {
    return NextResponse.json({ error: 'Đây không phải finding của bạn.' }, { status: 403 });
  }
  if (row.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Finding đã nộp, không chuẩn hoá lại được.' }, { status: 409 });
  }

  try {
    const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, fid));

    const { result, model, warnings } = await standardizeFinding({
      rawText: row.rawText,
      standards: row.standards as StandardCode[],
      area: row.rawArea ?? undefined,
      process: row.rawProcess ?? undefined,
      auditee: row.auditee ?? undefined,
      auditorName: row.auditorName ?? undefined,
      imageKeys: imgs.map((i) => i.key),
    });

    const [updated] = await db
      .update(findings)
      .set({
        title: result.title,
        severity: result.severity,
        evidence: result.evidence,
        statement: result.statement,
        clauses: result.clauses.map((c) => ({
          standard: c.standard, clause: c.clause, clauseTitle: c.clauseTitle,
        })),
        missingInfo: result.missingInfo,
        aiModel: model,
        aiRaw: result,
        updatedAt: new Date(),
      })
      .where(eq(findings.id, fid))
      .returning();

    // Ghi chú ảnh do AI sinh ra, gắn vào từng ảnh theo thứ tự.
    if (result.imageNotes?.length) {
      await Promise.all(
        imgs.map((img, i) =>
          result.imageNotes[i]
            ? db.update(findingImages).set({ caption: result.imageNotes[i] }).where(eq(findingImages.id, img.id))
            : Promise.resolve(),
        ),
      );
    }

    return NextResponse.json({ finding: updated, warnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lỗi không xác định khi gọi AI.';
    console.error('[chuan-hoa]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
