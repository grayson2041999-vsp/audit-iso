import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditSessions, audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { DEFAULT_RANGES, pinMeetings, resolveAuditDays, type PlanSession } from '@/lib/plan';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  organization: z.string().trim().min(1, 'Nhập tên tổ chức được đánh giá'),
  title: z.string().trim().min(1, 'Nhập tên đợt đánh giá'),
  scope: z.string().optional(),
  standards: z.array(z.enum(['ISO9001', 'ISO14001', 'ISO45001'])).min(1, 'Chọn ít nhất một tiêu chuẩn'),
  leadAuditor: z.string().trim().min(1, 'Nhập tên trưởng đoàn'),
  /** Ngày thực hiện, không cần liền nhau. Gửi kèm thì thay cả danh sách. */
  days: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ'))
    .min(1, 'Chọn ít nhất một ngày thực hiện')
    .max(60, 'Tối đa 60 ngày thực hiện')
    .optional(),
});

/**
 * Sửa thông tin gốc của đợt đánh giá, gồm cả danh sách ngày thực hiện.
 *
 * Đổi ngày thì lịch đi theo:
 *  - ngày giữ lại: giữ nguyên khoảng giờ và các phiên,
 *  - ngày thêm mới: khoảng giờ mặc định, chưa có phiên,
 *  - ngày bị bỏ: các phiên trên ngày đó bị xoá (trình duyệt đã hỏi lại trước),
 *  - họp khai mạc / kết thúc dời theo ngày đầu / ngày cuối mới.
 * Khoảng giờ và lịch chi tiết chỉnh ở tab Chương trình.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.' },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const audit = owned.audit;

  const current = resolveAuditDays(audit);
  const dates = d.days ? [...new Set(d.days)].sort() : null;
  const daysChanged = dates !== null && dates.join() !== current.map((x) => x.date).join();
  const byDate = new Map(current.map((x) => [x.date, x]));
  const nextDays = dates?.map(
    (date) => byDate.get(date) ?? { date, ranges: DEFAULT_RANGES.map((r) => ({ ...r })) },
  );

  try {
    await db
      .update(audits)
      .set({
        organization: d.organization,
        title: d.title,
        scope: d.scope?.trim() || null,
        standards: d.standards,
        leadAuditor: d.leadAuditor,
        ...(daysChanged && dates && nextDays
          ? {
              auditDays: nextDays,
              // Hai cột ngày đầu / ngày cuối luôn khớp theo danh sách ngày.
              startDate: new Date(dates[0]),
              endDate: new Date(dates[dates.length - 1]),
              updatedAt: new Date(),
            }
          : {}),
      })
      .where(eq(audits.id, id));

    if (daysChanged && dates && nextDays) {
      const keep = new Set(dates);
      const sessions = await db.select().from(auditSessions).where(eq(auditSessions.auditId, id));
      const isPinned = (k: string) => k === 'OPENING' || k === 'CLOSING';

      const dropIds = sessions.filter((s) => !keep.has(s.day) && !isPinned(s.kind)).map((s) => s.id);
      if (dropIds.length > 0) {
        await db.delete(auditSessions).where(inArray(auditSessions.id, dropIds));
      }

      // Chưa lưu lịch lần nào thì tab Chương trình tự ghim hai cuộc họp khi mở.
      if (sessions.length > 0) {
        const remaining = sessions.filter((s) => !dropIds.includes(s.id));
        const pinned = pinMeetings(
          remaining.map((s): PlanSession => ({
            id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime,
            kind: s.kind as PlanSession['kind'], unitId: s.unitId, note: s.note,
          })),
          nextDays,
          { openingMinutes: audit.openingMinutes, closingMinutes: audit.closingMinutes },
          randomUUID,
        );
        for (const m of pinned.filter((s) => isPinned(s.kind))) {
          if (remaining.some((s) => s.id === m.id)) {
            await db
              .update(auditSessions)
              .set({ day: m.day, startTime: m.startTime, endTime: m.endTime })
              .where(eq(auditSessions.id, m.id));
          } else {
            await db.insert(auditSessions).values({
              id: m.id, auditId: id, day: m.day, startTime: m.startTime, endTime: m.endTime,
              kind: m.kind, unitId: null, note: null,
            });
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[audits:PATCH]', e);
    return NextResponse.json({ error: 'Không lưu được vào cơ sở dữ liệu.' }, { status: 500 });
  }
}
