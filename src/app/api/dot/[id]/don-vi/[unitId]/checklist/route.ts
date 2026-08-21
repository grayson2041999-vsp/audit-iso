import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits, auditSessions, auditUnits } from '@/lib/schema';
import { checklistRequestSchema } from '@/lib/types';
import { generateChecklistStream, isAiConfigured } from '@/lib/ai';
import { AI_HOURLY_LIMIT, checkAiQuota, recordAiUsage } from '@/lib/ai-quota';
import { resolveActor } from '@/lib/actor';
import { memberOwnsUnit } from '@/lib/member-auth';
import { sortStandards } from '@/lib/iso';
import { toMinutes } from '@/lib/plan';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; unitId: string }> };

/**
 * Sinh checklist đánh giá cho một đơn vị. NDJSON chảy dần, cùng định dạng với
 * `/api/standardize` — xem chú thích ở route đó về lý do chọn NDJSON.
 *
 * NĂM CỬA PHẢI QUA TRƯỚC KHI ĐỘNG TỚI TIỀN API:
 *
 *   1. Dữ liệu gửi lên có hợp lệ không          → 400
 *   2. Người gọi là ai                          → 401
 *   3. Đợt còn mở không                         → 409
 *   4. Có được giao đơn vị này không            → 404
 *   5. Còn lượt trong giờ này không             → 429
 *
 * Cửa 4 là cửa `/api/standardize` không có: ở đó đơn vị nằm trong thân request
 * và chỉ dùng làm chữ, còn ở đây đơn vị nằm trong đường dẫn và quyết định dữ
 * liệu nào được đọc ra. Trả 404 chứ không 403 — không xác nhận đơn vị có tồn
 * tại hay không cho người không được giao.
 *
 * KHÔNG GHI GÌ VÀO CƠ SỞ DỮ LIỆU. Checklist chỉ sống trong màn hình của đánh
 * giá viên cho tới khi họ tải file Word. Xem `docs/concept-checklist.md` mục 8
 * về đánh đổi này.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, unitId } = await params;

  if (!isAiConfigured()) {
    return NextResponse.json({ error: 'Chưa cấu hình ANTHROPIC_API_KEY.' }, { status: 503 });
  }

  /* --- Cửa 1: dữ liệu hợp lệ --- */
  const parsed = checklistRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  /* --- Cửa 2: anh là ai --- */
  const actor = await resolveActor(id);
  if (!actor) {
    return NextResponse.json(
      { error: 'Chưa đăng nhập vào đợt đánh giá. Vui lòng mở lại link đợt và nhập mã.' },
      { status: 401 },
    );
  }

  /* --- Cửa 3: đợt còn mở --- */
  if (actor.auditClosed) {
    return NextResponse.json({ error: 'Đợt đã khoá.' }, { status: 409 });
  }

  /* --- Cửa 4: đơn vị này có phải của anh không --- */
  if (actor.kind === 'member' && !(await memberOwnsUnit(id, actor.id, unitId))) {
    return NextResponse.json({ error: 'Không tìm thấy đơn vị.' }, { status: 404 });
  }

  const [unit] = await db
    .select()
    .from(auditUnits)
    .where(and(eq(auditUnits.id, unitId), eq(auditUnits.auditId, id)));
  if (!unit) return NextResponse.json({ error: 'Không tìm thấy đơn vị.' }, { status: 404 });

  /* --- Cửa 5: còn lượt --- */
  const quota = await checkAiQuota(actor.key);
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.message },
      { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } },
    );
  }

  const audit = await loadAudit(id);
  const sessionMinutes = await unitSessionMinutes(id, unitId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const event of generateChecklistStream({
          unitName: unit.name,
          unitNote: unit.note,
          description: parsed.data.description,
          standards: sortStandards(audit.standards),
          organization: audit.organization,
          objectives: audit.objectives,
          criteria: audit.criteria,
          sessionMinutes,
          auditorName: actor.name,
        })) {
          // Chỉ tính lượt khi AI thực sự trả về kết quả — xem `/api/standardize`.
          if (event.type === 'done') {
            await recordAiUsage(actor, 'checklist');
            send({ ...event, quota: { remaining: quota.remaining - 3, limit: AI_HOURLY_LIMIT } });
            continue;
          }
          send(event);
        }
      } catch (e) {
        console.error('[checklist]', e);
        send({
          type: 'error',
          error: e instanceof Error ? e.message : 'Lỗi không xác định khi gọi AI.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function loadAudit(id: string) {
  const [row] = await db.select().from(audits).where(eq(audits.id, id));
  if (!row) throw new Error('Không tìm thấy đợt đánh giá.');
  return row;
}

/**
 * Thời lượng phiên làm việc với đơn vị này, tính bằng phút — dùng để định cỡ
 * checklist. `null` khi đợt chưa xếp lịch.
 *
 * Một đơn vị có thể có nhiều phiên (bị cắt làm hai buổi, hoặc hai đánh giá viên
 * làm hai lúc). Cộng dồn chứ không lấy phiên đầu: tổng thời gian đứng trong
 * đơn vị mới là thứ quyết định làm được bao nhiêu việc.
 */
async function unitSessionMinutes(auditId: string, unitId: string): Promise<number | null> {
  const rows = await db
    .select({ startTime: auditSessions.startTime, endTime: auditSessions.endTime })
    .from(auditSessions)
    .where(
      and(
        eq(auditSessions.auditId, auditId),
        eq(auditSessions.unitId, unitId),
        eq(auditSessions.kind, 'UNIT'),
      ),
    );

  if (rows.length === 0) return null;
  const total = rows.reduce((n, r) => n + Math.max(0, toMinutes(r.endTime) - toMinutes(r.startTime)), 0);
  return total > 0 ? total : null;
}
