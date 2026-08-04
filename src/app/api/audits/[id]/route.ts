import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditSessions, audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { formatDayLong, listDays } from '@/lib/plan';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const dayRe = /^\d{4}-\d{2}-\d{2}$/;

const schema = z
  .object({
    organization: z.string().trim().min(1, 'Nhập tên tổ chức được đánh giá'),
    title: z.string().trim().min(1, 'Nhập tên đợt đánh giá'),
    scope: z.string().optional(),
    standards: z.array(z.enum(['ISO9001', 'ISO14001', 'ISO45001'])).min(1, 'Chọn ít nhất một tiêu chuẩn'),
    leadAuditor: z.string().trim().min(1, 'Nhập tên trưởng đoàn'),
    startDate: z.string().regex(dayRe, 'Ngày bắt đầu không hợp lệ'),
    endDate: z.string().regex(dayRe, 'Ngày kết thúc không hợp lệ'),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
    path: ['endDate'],
  });

/**
 * Sửa thông tin gốc của đợt đánh giá.
 *
 * Đổi ngày là thao tác nguy hiểm nhất ở đây: rút ngắn khoảng ngày có thể khiến
 * những phiên đã xếp rơi ra ngoài đợt. Chỗ này KHÔNG tự dời và KHÔNG tự xoá
 * chúng — lịch là thứ trưởng đoàn bỏ công sắp, hệ thống im lặng sửa sau lưng
 * thì tới lúc xuất Word mới phát hiện mất phiên. Thay vào đó nó từ chối lưu và
 * nói rõ ngày nào đang vướng, để trưởng đoàn tự quyết gỡ hay giữ.
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

  try {
    // Khoảng ngày mới có chứa hết các phiên đã xếp không.
    const keep = new Set(listDays(d.startDate, d.endDate));
    const rows = await db
      .select({ day: auditSessions.day })
      .from(auditSessions)
      .where(eq(auditSessions.auditId, id));

    const orphanDays = [...new Set(rows.map((r) => r.day))].filter((day) => !keep.has(day)).sort();

    if (orphanDays.length > 0) {
      const n = rows.filter((r) => !keep.has(r.day)).length;
      return NextResponse.json(
        {
          error:
            `Khoảng ngày mới không còn ${orphanDays.map(formatDayLong).join(', ')}, ` +
            `nhưng ${n} phiên đang nằm ở đó. Sang tab Chương trình dời hoặc bỏ các phiên ấy trước, rồi đổi ngày.`,
        },
        { status: 409 },
      );
    }

    await db
      .update(audits)
      .set({
        organization: d.organization,
        title: d.title,
        scope: d.scope?.trim() || null,
        standards: d.standards,
        leadAuditor: d.leadAuditor,
        startDate: new Date(d.startDate),
        endDate: new Date(d.endDate),
      })
      .where(eq(audits.id, id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[audits:PATCH]', e);
    return NextResponse.json({ error: 'Không lưu được vào cơ sở dữ liệu.' }, { status: 500 });
  }
}
