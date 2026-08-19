import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findingImages, findings } from '@/lib/schema';
import { getMember } from '@/lib/member-auth';
import { standardizeFinding, isAiConfigured } from '@/lib/ai';
import { checkAiQuota, recordAiUsage } from '@/lib/ai-quota';
import type { Actor } from '@/lib/actor';
import type { StandardCode } from '@/lib/iso';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; fid: string }> };

/**
 * Chuẩn hoá một finding đã lưu nháp.
 *
 * Toàn bộ việc gọi AI và ghi kết quả làm ở phía máy chủ trong một lượt, để
 * trình duyệt không phải tự điều phối hai lời gọi rồi lỡ mất kết quả giữa chừng.
 *
 * Route này vốn đã hỏi danh tính (khác `/api/standardize` trước đây), nhưng vẫn
 * phải chia CHUNG hạn mức giờ với nó — nếu không, chặn cửa trước mà để ngỏ cửa
 * sau: bấm "chuẩn hoá lại" liên tục cũng tốn đúng chừng ấy tiền API.
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

  /**
   * Kiểm hạn mức SAU các bước kiểm quyền và tìm bản ghi, nhưng TRƯỚC khi gọi
   * AI. Đặt sau để lỗi "không phải finding của bạn" hiện ra trước lỗi hạn mức —
   * báo đúng nguyên nhân thật thì người dùng mới sửa được.
   */
  const actor: Actor = {
    kind: 'member',
    id: session.member.id,
    key: `member:${session.member.id}`,
    name: session.member.fullName,
    auditId: id,
    // Đã kiểm ở trên rồi, tới được đây nghĩa là đợt còn mở.
    auditClosed: false,
  };

  const quota = await checkAiQuota(actor.key);
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.message },
      { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } },
    );
  }

  try {
    const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, fid));

    const { result, model, warnings } = await standardizeFinding({
      rawText: row.rawText,
      standards: row.standards as StandardCode[],
      area: row.rawArea ?? undefined,
      auditee: row.auditee ?? undefined,
      auditorName: row.auditorName ?? undefined,
      imageKeys: imgs.map((i) => i.key),
    });

    // Gọi được tới đây nghĩa là AI đã trả kết quả — lúc này mới tính một lượt.
    await recordAiUsage(actor, 'restandardize');

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
