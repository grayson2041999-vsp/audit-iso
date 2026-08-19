import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { correctiveEvents, correctiveItems, correctiveReports } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { currentPhase, type CapaStatus } from '@/lib/capa';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; unitId: string }> };

const schema = z.object({
  action: z.enum(['approve', 'reject']),
  /** Bắt buộc khi trả lại — đơn vị phải biết vì sao. */
  note: z.string().trim().optional(),
  /**
   * Chấm từng mục. Đơn vị nộp cả gói nhưng phản hồi thì chi tiết tới từng
   * finding, để họ không phải làm lại từ đầu chỉ vì một mục chưa đạt.
   */
  verdicts: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        verdict: z.enum(['OK', 'NG']).nullable(),
        leaderNote: z.string().trim().optional(),
      }),
    )
    .optional()
    .default([]),
});

/**
 * Trưởng đoàn duyệt hoặc trả lại gói khắc phục của một đơn vị.
 *
 * Route này phục vụ CẢ HAI MỐC — duyệt kế hoạch và xác nhận hiệu lực. Đang ở
 * mốc nào thì suy từ trạng thái hiện tại chứ không nhận từ trình duyệt: để
 * client tự khai mốc là mở đường cho việc nhảy cóc qua mốc kế hoạch.
 *
 *   PLAN_SUBMITTED     + approve → PLAN_APPROVED       (đơn vị đi làm)
 *   PLAN_SUBMITTED     + reject  → PLAN_REJECTED       (sửa kế hoạch)
 *   EVIDENCE_SUBMITTED + approve → CLOSED              (xác nhận hiệu lực)
 *   EVIDENCE_SUBMITTED + reject  → EVIDENCE_REJECTED   (bổ sung bằng chứng)
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, unitId } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const { action, verdicts } = parsed.data;
  const note = parsed.data.note ?? '';

  if (action === 'reject' && note.length < 5) {
    return NextResponse.json(
      { error: 'Trả lại phải nêu lý do — đơn vị cần biết phải sửa gì.' },
      { status: 400 },
    );
  }

  const [report] = await db
    .select()
    .from(correctiveReports)
    .where(and(eq(correctiveReports.auditId, id), eq(correctiveReports.unitId, unitId)));

  if (!report) return NextResponse.json({ error: 'Đơn vị chưa có hồ sơ khắc phục.' }, { status: 404 });

  const status = report.status as CapaStatus;
  if (status !== 'PLAN_SUBMITTED' && status !== 'EVIDENCE_SUBMITTED') {
    return NextResponse.json(
      { error: 'Hồ sơ không ở trạng thái chờ duyệt. Có thể ai đó vừa xử lý trước bạn.' },
      { status: 409 },
    );
  }

  const phase = currentPhase(status) === 'evidence' ? 'evidence' : 'plan';

  try {
    /* --- Chấm từng mục --- */
    for (const v of verdicts) {
      await db
        .update(correctiveItems)
        .set({
          verdict: v.verdict,
          leaderNote: v.leaderNote?.trim() || null,
          updatedAt: new Date(),
        })
        .where(and(eq(correctiveItems.id, v.itemId), eq(correctiveItems.reportId, report.id)));
    }

    const items = await db
      .select()
      .from(correctiveItems)
      .where(and(eq(correctiveItems.reportId, report.id), eq(correctiveItems.isActive, true)))
      .orderBy(asc(correctiveItems.createdAt));

    /**
     * Không cho duyệt khi còn mục bị chấm "chưa đạt". Nếu không, trưởng đoàn dễ
     * vô tình đóng một hồ sơ mà chính mình vừa đánh dấu là chưa được.
     */
    if (action === 'approve') {
      const ng = items.filter((it) => it.verdict === 'NG');
      if (ng.length > 0) {
        return NextResponse.json(
          { error: `Còn ${ng.length} mục đang đánh dấu "chưa đạt". Bỏ đánh dấu hoặc trả lại hồ sơ.` },
          { status: 409 },
        );
      }
    }

    const now = new Date();
    let next: CapaStatus;
    if (phase === 'plan') {
      next = action === 'approve' ? 'PLAN_APPROVED' : 'PLAN_REJECTED';
    } else {
      next = action === 'approve' ? 'CLOSED' : 'EVIDENCE_REJECTED';
    }

    await db.insert(correctiveEvents).values({
      reportId: report.id,
      round: report.round,
      phase,
      action,
      actor: owned.leader.fullName,
      note: note || null,
      snapshot: { report, items },
    });

    await db
      .update(correctiveReports)
      .set({
        status: next,
        reviewNote: note || null,
        // Trả lại thì sang lượt mới, để nhật ký đếm được đơn vị phải làm mấy lần.
        round: action === 'reject' ? report.round + 1 : report.round,
        ...(phase === 'plan' ? { planReviewedAt: now } : {}),
        ...(next === 'CLOSED' ? { closedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(correctiveReports.id, report.id));

    return NextResponse.json({ ok: true, status: next });
  } catch (e) {
    console.error('[khac-phuc:duyet]', e);
    return NextResponse.json({ error: 'Không xử lý được hồ sơ.' }, { status: 500 });
  }
}
