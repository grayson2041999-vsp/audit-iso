import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditSessions, audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const schema = z.object({
  /* --- Thông tin chương trình --- */
  objectives: z.string().optional().nullable(),
  criteria: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  approverTitle: z.string().optional().nullable(),
  approverName: z.string().optional().nullable(),
  amStart: z.string().regex(timeRe, 'Giờ không hợp lệ').optional(),
  amEnd: z.string().regex(timeRe, 'Giờ không hợp lệ').optional(),
  pmStart: z.string().regex(timeRe, 'Giờ không hợp lệ').optional(),
  pmEnd: z.string().regex(timeRe, 'Giờ không hợp lệ').optional(),
  openingMinutes: z.number().int().min(15).max(480).optional(),
  closingMinutes: z.number().int().min(15).max(480).optional(),
  /** Khung giờ riêng từng ngày, theo thứ tự ngày trong đợt. */
  dayHours: z
    .array(
      z.object({
        amStart: z.string().regex(timeRe, 'Giờ không hợp lệ'),
        amEnd: z.string().regex(timeRe, 'Giờ không hợp lệ'),
        pmStart: z.string().regex(timeRe, 'Giờ không hợp lệ'),
        pmEnd: z.string().regex(timeRe, 'Giờ không hợp lệ'),
      }),
    )
    .max(60)
    .optional(),

  /* --- Toàn bộ lịch, ghi đè --- */
  sessions: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z.string().regex(timeRe, 'Giờ không hợp lệ'),
        endTime: z.string().regex(timeRe, 'Giờ không hợp lệ'),
        kind: z.enum(['OPENING', 'UNIT', 'INTERNAL', 'CLOSING']),
        unitId: z.string().uuid().nullable(),
        note: z.string().nullable().optional(),
      }),
    )
    .max(500)
    .optional(),
});

/**
 * Lưu cả chương trình trong MỘT lượt: thông tin kế hoạch, đại diện đơn vị, và
 * toàn bộ lịch. Cùng cách làm với ma trận phân công — trưởng đoàn sắp thoải mái
 * rồi mới bấm Lưu, không có lượt mạng nào giữa chừng.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  try {
    await db
      .update(audits)
      .set({
        objectives: d.objectives ?? null,
        criteria: d.criteria ?? null,
        location: d.location ?? null,
        // In hoa ở máy chủ luôn, không tin mỗi phía trình duyệt.
        approverTitle: d.approverTitle ? d.approverTitle.toLocaleUpperCase('vi') : null,
        approverName: d.approverName ?? null,
        ...(d.amStart ? { amStart: d.amStart } : {}),
        ...(d.amEnd ? { amEnd: d.amEnd } : {}),
        ...(d.pmStart ? { pmStart: d.pmStart } : {}),
        ...(d.pmEnd ? { pmEnd: d.pmEnd } : {}),
        ...(d.openingMinutes ? { openingMinutes: d.openingMinutes } : {}),
        ...(d.closingMinutes ? { closingMinutes: d.closingMinutes } : {}),
        ...(d.dayHours ? { dayHours: d.dayHours } : {}),
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));


    if (d.sessions) {
      // Lịch là một khối thống nhất, không có khoá tự nhiên để đối chiếu từng
      // dòng, nên ghi đè cả bộ. Xoá rồi chèn lại trong cùng một lượt yêu cầu.
      await db.delete(auditSessions).where(eq(auditSessions.auditId, id));

      if (d.sessions.length > 0) {
        await db.insert(auditSessions).values(
          d.sessions.map((s) => ({
            auditId: id,
            day: s.day,
            startTime: s.startTime,
            endTime: s.endTime,
            kind: s.kind,
            unitId: s.kind === 'UNIT' ? s.unitId : null,
            note: s.note ?? null,
          })),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[chuong-trinh:PUT]', e);
    return NextResponse.json({ error: 'Không lưu được chương trình đánh giá.' }, { status: 500 });
  }
}
