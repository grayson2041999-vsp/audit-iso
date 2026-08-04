import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { audits, findingImages, findings } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { deleteObject, isR2Configured } from '@/lib/r2';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Người dùng phải gõ lại đúng tên đợt — chống bấm nhầm. */
  confirm: z.string(),
});

/** So chuỗi bỏ qua khoảng trắng thừa và hoa thường. */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Xoá vĩnh viễn một đợt đánh giá.
 *
 * Dữ liệu trong database tự xoá theo (ON DELETE CASCADE): đơn vị, đánh giá viên,
 * phân công, finding, ảnh, lịch sử chỉnh sửa. Nhưng file ảnh trên Cloudflare R2
 * KHÔNG nằm trong database, phải xoá tay — nếu bỏ qua thì kho ảnh sẽ đầy dần
 * bằng những file không còn ai tham chiếu tới và không cách nào tìm lại.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }

  if (norm(parsed.data.confirm) !== norm(owned.audit.title)) {
    return NextResponse.json(
      { error: 'Tên đợt nhập lại không khớp. Kiểm tra lại rồi thử tiếp.' },
      { status: 400 },
    );
  }

  try {
    // 1. Gom toàn bộ key ảnh của mọi finding thuộc đợt này.
    const rows = await db
      .select({ id: findings.id })
      .from(findings)
      .where(eq(findings.auditId, id));

    let deletedImages = 0;
    if (rows.length > 0) {
      const imgs = await db
        .select({ key: findingImages.key })
        .from(findingImages)
        .where(inArray(findingImages.findingId, rows.map((r) => r.id)));

      if (isR2Configured() && imgs.length > 0) {
        // allSettled: một ảnh xoá lỗi không được chặn việc xoá cả đợt.
        const results = await Promise.allSettled(imgs.map((i) => deleteObject(i.key)));
        deletedImages = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.length - deletedImages;
        if (failed > 0) {
          console.warn(`[audit:xoa] ${failed} ảnh trên R2 không xoá được, để lại rác.`);
        }
      }
    }

    // 2. Xoá đợt — mọi bảng con tự xoá theo ràng buộc khoá ngoại.
    await db.delete(audits).where(eq(audits.id, id));

    return NextResponse.json({ ok: true, deletedFindings: rows.length, deletedImages });
  } catch (e) {
    console.error('[audit:xoa]', e);
    return NextResponse.json({ error: 'Không xoá được đợt đánh giá.' }, { status: 500 });
  }
}
