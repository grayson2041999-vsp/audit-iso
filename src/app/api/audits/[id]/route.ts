import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
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
 * Đổi ngày là chỗ khó nhất. Lịch không bám vào ngày dương lịch mà bám vào THỨ
 * TỰ NGÀY TRONG ĐỢT: phiên nằm ở ngày 1 thì vẫn ở ngày 1 sau khi đổi, chỉ đổi
 * ngày dương lịch tương ứng. Nhờ vậy dời cả đợt sang tuần khác — việc hay xảy
 * ra nhất khi đơn vị xin hoãn — không mất công sắp lại lịch.
 *
 * Chỉ có một trường hợp không tự xử được: rút ngắn đợt khiến những ngày cuối
 * biến mất trong khi vẫn còn phiên nằm đó. Lúc ấy hệ thống từ chối lưu và nói
 * rõ ngày nào đang vướng, chứ không tự xoá phiên sau lưng trưởng đoàn.
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
    const oldDays = listDays(owned.audit.startDate, owned.audit.endDate);
    const newDays = listDays(d.startDate, d.endDate);

    const rows = await db
      .select({ day: auditSessions.day })
      .from(auditSessions)
      .where(eq(auditSessions.auditId, id));

    /** Ngày dương lịch cũ → ngày dương lịch mới, ghép theo thứ tự ngày trong đợt. */
    const remap = new Map<string, string>();
    const lost: string[] = [];
    oldDays.forEach((day, i) => {
      if (i < newDays.length) remap.set(day, newDays[i]);
      else lost.push(day);
    });

    // Phiên nằm ở ngày bị cắt mất, hoặc ở ngày lạ không thuộc đợt cũ.
    const stranded = rows.filter((r) => !remap.has(r.day));
    if (stranded.length > 0) {
      const days = [...new Set(stranded.map((r) => r.day))].sort();
      const reason = lost.length > 0 ? 'Rút ngắn đợt sẽ bỏ mất' : 'Có phiên nằm ngoài đợt ở';
      return NextResponse.json(
        {
          error:
            `${reason} ${days.map(formatDayLong).join(', ')}, đang có ${stranded.length} phiên. ` +
            'Sang tab Chương trình dời hoặc bỏ các phiên đó trước, rồi đổi ngày.',
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

    /**
     * Dời lịch theo. Chỉ đụng những ngày thực sự đổi, và làm sau khi đã cập nhật
     * đợt: nếu bước này hỏng giữa chừng thì lịch lệch, còn hơn là đợt và lịch
     * cùng ở trạng thái nửa vời.
     */
    for (const [from, to] of remap) {
      if (from === to) continue;
      await db
        .update(auditSessions)
        .set({ day: to })
        .where(and(eq(auditSessions.auditId, id), eq(auditSessions.day, from)));
    }

    return NextResponse.json({ ok: true, movedSessions: rows.length });
  } catch (e) {
    console.error('[audits:PATCH]', e);
    return NextResponse.json({ error: 'Không lưu được vào cơ sở dữ liệu.' }, { status: 500 });
  }
}
