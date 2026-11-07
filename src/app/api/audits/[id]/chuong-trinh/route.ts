import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditSessions, audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { formatDayLong, rangesProblem, resolveAuditDays, sortRanges } from '@/lib/plan';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

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
  /**
   * Ngày thực hiện: danh sách ngày cụ thể, không cần liền nhau, mỗi ngày một
   * hoặc nhiều khoảng giờ làm việc. Gửi kèm thì thay cả danh sách.
   */
  days: z
    .array(
      z
        .object({
          date: z.string().regex(dayRe, 'Ngày không hợp lệ'),
          ranges: z
            .array(
              z.object({
                start: z.string().regex(timeRe, 'Giờ không hợp lệ'),
                end: z.string().regex(timeRe, 'Giờ không hợp lệ'),
              }),
            )
            .min(1, 'Mỗi ngày phải có ít nhất một khoảng giờ')
            .max(6, 'Tối đa 6 khoảng giờ mỗi ngày'),
        })
        .refine((x) => rangesProblem(x.ranges) === null, {
          message: 'Khoảng giờ của một ngày không hợp lệ (kết thúc trước bắt đầu, hoặc chồng nhau)',
        }),
    )
    .min(1, 'Đợt phải có ít nhất một ngày thực hiện')
    .max(60, 'Tối đa 60 ngày thực hiện')
    .optional(),

  /* --- Toàn bộ lịch, ghi đè --- */
  sessions: z
    .array(
      z.object({
        day: z.string().regex(dayRe),
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
 * Lưu cả chương trình trong MỘT lượt: thông tin chương trình, ngày thực hiện
 * và toàn bộ lịch. Trưởng đoàn sắp xếp xong trên màn hình rồi mới bấm Lưu.
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

  /* ---- Ngày thực hiện: sắp xếp, không trùng, lịch không được nằm ngoài ---- */
  const days = d.days ? [...d.days].sort((a, b) => a.date.localeCompare(b.date)) : null;
  if (days) {
    const dup = days.find((x, i) => i > 0 && x.date === days[i - 1].date);
    if (dup) {
      return NextResponse.json(
        { error: `Ngày ${formatDayLong(dup.date)} bị khai hai lần.` },
        { status: 400 },
      );
    }
  }
  if (d.sessions) {
    const allowed = new Set(
      (days ?? resolveAuditDays(owned.audit)).map((x) => x.date),
    );
    const outside = [...new Set(d.sessions.map((s) => s.day).filter((x) => !allowed.has(x)))];
    if (outside.length > 0) {
      return NextResponse.json(
        {
          error:
            `Lịch còn phiên ở ${outside.sort().map(formatDayLong).join(', ')}. ` +
            'Ngày này không có trong danh sách ngày thực hiện.',
        },
        { status: 400 },
      );
    }
  }

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
        ...(days
          ? {
              auditDays: days.map((x) => ({ date: x.date, ranges: sortRanges(x.ranges) })),
              // Giữ hai cột cũ khớp theo — danh sách đợt, đầu trang, file Excel vẫn đọc chúng.
              startDate: new Date(days[0].date),
              endDate: new Date(days[days.length - 1].date),
            }
          : {}),
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
