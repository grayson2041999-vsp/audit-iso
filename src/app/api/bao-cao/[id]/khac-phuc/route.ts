import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { correctiveEvents, correctiveItems, correctiveReports } from '@/lib/schema';
import { getUnitSession } from '@/lib/unit-auth';
import { currentPhase, missingForSubmit, unitCanEdit, type CapaStatus } from '@/lib/capa';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** `false` = lưu nháp, `true` = nộp cho trưởng đoàn. */
  submit: z.boolean().default(false),
  responsibleName: z.string().trim().optional(),
  responsibleTitle: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        immediateAction: z.string().optional(),
        rootCause: z.string().optional(),
        actionPlan: z.string().optional(),
        /** "YYYY-MM-DD" hoặc rỗng. */
        targetDate: z.string().optional().nullable(),
        completionNote: z.string().optional(),
        attachments: z
          .array(
            z.object({
              key: z.string(),
              fileName: z.string().nullable().optional(),
              contentType: z.string().nullable().optional(),
              size: z.number().nullable().optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
});

/**
 * Đơn vị lưu nháp hoặc nộp gói khắc phục.
 *
 * MỘT route cho cả hai mốc. Đang ở mốc kế hoạch hay mốc bằng chứng thì suy từ
 * trạng thái hồ sơ, không nhận từ trình duyệt — để client tự khai mốc là mở
 * đường nộp bằng chứng khi kế hoạch còn chưa được duyệt.
 *
 * Trường nào được ghi cũng phụ thuộc mốc: ở mốc kế hoạch thì `completionNote`
 * bị bỏ qua và ngược lại. Nhờ vậy đơn vị không vô tình sửa lại kế hoạch đã
 * được duyệt trong lúc nộp bằng chứng.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;

  const session = await getUnitSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Chưa đăng nhập. Vui lòng nhập lại mã.' }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const body = parsed.data;

  const [report] = await db
    .select()
    .from(correctiveReports)
    .where(
      and(eq(correctiveReports.auditId, id), eq(correctiveReports.unitId, session.unit.id)),
    );

  if (!report) {
    return NextResponse.json(
      { error: 'Đơn vị không có sự không phù hợp nào cần khắc phục.' },
      { status: 404 },
    );
  }

  const status = report.status as CapaStatus;
  if (!unitCanEdit(status)) {
    return NextResponse.json(
      { error: 'Hồ sơ đang chờ trưởng đoàn xử lý, chưa sửa được.' },
      { status: 409 },
    );
  }

  const phase = currentPhase(status) === 'evidence' ? 'evidence' : 'plan';

  try {
    const owned = await db
      .select()
      .from(correctiveItems)
      .where(and(eq(correctiveItems.reportId, report.id), eq(correctiveItems.isActive, true)))
      .orderBy(asc(correctiveItems.createdAt));
    const ownedIds = new Set(owned.map((it) => it.id));

    /* --- Ghi nội dung, chỉ những trường thuộc mốc hiện tại --- */
    for (const it of body.items) {
      if (!ownedIds.has(it.itemId)) continue; // Không phải mục của đơn vị này.

      const patch =
        phase === 'plan'
          ? {
              immediateAction: it.immediateAction?.trim() || null,
              rootCause: it.rootCause?.trim() || null,
              actionPlan: it.actionPlan?.trim() || null,
              targetDate: it.targetDate ? new Date(it.targetDate) : null,
            }
          : {
              completionNote: it.completionNote?.trim() || null,
              ...(it.attachments ? { attachments: it.attachments.map(normalizeAttachment) } : {}),
            };

      await db
        .update(correctiveItems)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(correctiveItems.id, it.itemId));
    }

    if (phase === 'plan') {
      await db
        .update(correctiveReports)
        .set({
          responsibleName: body.responsibleName?.trim() || null,
          responsibleTitle: body.responsibleTitle?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(correctiveReports.id, report.id));
    }

    if (!body.submit) return NextResponse.json({ ok: true, saved: true });

    /* --- Nộp: kiểm lại đầy đủ ở máy chủ --- */
    const fresh = await db
      .select()
      .from(correctiveItems)
      .where(and(eq(correctiveItems.reportId, report.id), eq(correctiveItems.isActive, true)))
      .orderBy(asc(correctiveItems.createdAt));

    const missing = missingForSubmit(phase, fresh, {
      name: body.responsibleName ?? report.responsibleName,
      title: body.responsibleTitle ?? report.responsibleTitle,
    });

    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Chưa nộp được, còn thiếu:\n· ' + missing.join('\n· ') },
        { status: 400 },
      );
    }

    const now = new Date();
    const next: CapaStatus = phase === 'plan' ? 'PLAN_SUBMITTED' : 'EVIDENCE_SUBMITTED';

    await db.insert(correctiveEvents).values({
      reportId: report.id,
      round: report.round,
      phase,
      action: 'submit',
      actor: body.responsibleName?.trim() || report.responsibleName || session.unit.name,
      snapshot: { items: fresh },
    });

    await db
      .update(correctiveReports)
      .set({
        status: next,
        /**
         * Xoá dấu chấm điểm của lượt trước khi nộp lại. Giữ lại thì đơn vị vừa
         * sửa xong vẫn thấy mục của mình bị gắn "chưa đạt", tưởng chưa gửi được.
         * Bản chấm cũ đã nằm trong `corrective_events` nên không mất gì.
         */
        ...(phase === 'plan' ? { planSubmittedAt: now } : { evidenceSubmittedAt: now }),
        reviewNote: null,
        updatedAt: now,
      })
      .where(eq(correctiveReports.id, report.id));

    await db
      .update(correctiveItems)
      .set({ verdict: null, leaderNote: null, updatedAt: now })
      .where(eq(correctiveItems.reportId, report.id));

    return NextResponse.json({ ok: true, status: next });
  } catch (e) {
    console.error('[bao-cao:khac-phuc]', e);
    return NextResponse.json({ error: 'Không lưu được hồ sơ.' }, { status: 500 });
  }
}

function normalizeAttachment(a: {
  key: string;
  fileName?: string | null;
  contentType?: string | null;
  size?: number | null;
}) {
  return {
    key: a.key,
    fileName: a.fileName ?? null,
    contentType: a.contentType ?? null,
    size: a.size ?? null,
  };
}
