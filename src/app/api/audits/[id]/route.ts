import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  organization: z.string().trim().min(1, 'Nhập tên tổ chức được đánh giá'),
  title: z.string().trim().min(1, 'Nhập tên đợt đánh giá'),
  scope: z.string().optional(),
  standards: z.array(z.enum(['ISO9001', 'ISO14001', 'ISO45001'])).min(1, 'Chọn ít nhất một tiêu chuẩn'),
  leadAuditor: z.string().trim().min(1, 'Nhập tên trưởng đoàn'),
});

/**
 * Sửa thông tin gốc của đợt đánh giá.
 *
 * Ngày thực hiện KHÔNG sửa ở đây nữa. Từ migration 014 đợt có danh sách ngày
 * cụ thể (rời rạc được), sửa ở tab Chương trình cùng với lịch — thêm, đổi, xoá
 * ngày đều đụng tới phiên nằm trên ngày đó, nên phải ở cùng chỗ với lịch.
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
    await db
      .update(audits)
      .set({
        organization: d.organization,
        title: d.title,
        scope: d.scope?.trim() || null,
        standards: d.standards,
        leadAuditor: d.leadAuditor,
      })
      .where(eq(audits.id, id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[audits:PATCH]', e);
    return NextResponse.json({ error: 'Không lưu được vào cơ sở dữ liệu.' }, { status: 500 });
  }
}
