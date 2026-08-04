import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditSessions, auditUnits, audits } from '@/lib/schema';
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

  /* --- Đại diện từng đơn vị --- */
  contacts: z.array(z.object({ unitId: z.string().uuid(), contactPerson: z.string() })).optional(),

  /* --- Toàn bộ lịch, ghi đè --- */
  sessions: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        half: z.enum(['AM', 'PM']),
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
        approverTitle: d.approverTitle ?? null,
        approverName: d.approverName ?? null,
        ...(d.amStart ? { amStart: d.amStart } : {}),
        ...(d.amEnd ? { amEnd: d.amEnd } : {}),
        ...(d.pmStart ? { pmStart: d.pmStart } : {}),
        ...(d.pmEnd ? { pmEnd: d.pmEnd } : {}),
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));

    if (d.contacts) {
      const valid = await db
        .select({ id: auditUnits.id })
        .from(auditUnits)
        .where(eq(auditUnits.auditId, id));
      const validIds = new Set(valid.map((u) => u.id));

      for (const c of d.contacts) {
        if (!validIds.has(c.unitId)) continue;
        await db
          .update(auditUnits)
          .set({ contactPerson: c.contactPerson.trim() || null })
          .where(eq(auditUnits.id, c.unitId));
      }
    }

    if (d.sessions) {
      // Lịch là một khối thống nhất, không có khoá tự nhiên để đối chiếu từng
      // dòng, nên ghi đè cả bộ. Xoá rồi chèn lại trong cùng một lượt yêu cầu.
      await db.delete(auditSessions).where(eq(auditSessions.auditId, id));

      if (d.sessions.length > 0) {
        await db.insert(auditSessions).values(
          d.sessions.map((s) => ({
            auditId: id,
            day: s.day,
            half: s.half,
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
