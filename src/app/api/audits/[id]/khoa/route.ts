import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditEvents, audits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  closed: z.boolean(),
  /** Bắt buộc khi mở lại một đợt ĐÃ phát hành báo cáo cho đơn vị. */
  reason: z.string().trim().optional(),
});

/**
 * Khoá đợt hoặc mở lại.
 * Mở lại trả về "Đang thực hiện" chứ không về "Đang chuẩn bị" — mã đã cấp rồi,
 * quay lại bước chuẩn bị sẽ làm đánh giá viên không vào được.
 *
 * ────────────────────────────────────────────────────────────────────
 * MỞ LẠI MỘT ĐỢT ĐÃ PHÁT HÀNH là hành động nhạy cảm nhất trong app, nên nó
 * chịu thêm hai ràng buộc:
 *
 *   · BẮT BUỘC NÊU LÝ DO, và lý do đi vào `audit_events`.
 *   · Việc sửa KHÔNG tự động tới tay đơn vị. Đơn vị đọc ảnh chụp của bản đã
 *     phát hành (xem `report_releases`), nên tới khi trưởng đoàn bấm phát hành
 *     bản mới thì họ vẫn đang thấy đúng bản cũ.
 *
 * Hai điều đó cộng lại cho ra thứ vừa chặt vừa dùng được: không ai sửa lén
 * được báo cáo đã gửi, nhưng lỗi chính tả hay một finding sai vẫn sửa được —
 * thay vì khoá chết rồi người ta lách bằng cách xoá đợt tạo lại.
 * ────────────────────────────────────────────────────────────────────
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }
  const { closed } = parsed.data;
  const reason = parsed.data.reason?.trim() ?? '';

  const alreadyIssued = Boolean(owned.audit.issuedAt);

  if (!closed && alreadyIssued && reason.length < 5) {
    return NextResponse.json(
      {
        error:
          'Đợt này đã gửi báo cáo cho đơn vị. Mở lại để sửa thì phải nêu lý do, ' +
          'và sau khi sửa xong phải phát hành bản mới thì đơn vị mới thấy thay đổi.',
      },
      { status: 400 },
    );
  }

  try {
    await db
      .update(audits)
      .set({
        status: closed ? 'CLOSED' : 'IN_PROGRESS',
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));

    await db.insert(auditEvents).values({
      auditId: id,
      actor: owned.leader.fullName,
      action: closed ? 'LOCK' : alreadyIssued ? 'UNLOCK_AFTER_RELEASE' : 'UNLOCK',
      note: reason || null,
    });

    return NextResponse.json({ ok: true, pendingRevision: !closed && alreadyIssued });
  } catch (e) {
    console.error('[audit:khoa]', e);
    return NextResponse.json({ error: 'Không đổi được trạng thái đợt.' }, { status: 500 });
  }
}
