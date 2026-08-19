import { NextResponse } from 'next/server';
import { standardizeRequestSchema } from '@/lib/types';
import { standardizeFindingStream, isAiConfigured } from '@/lib/ai';
import {
  AI_HOURLY_LIMIT, checkAiQuota, recordAiUsage, resolveAiActor,
} from '@/lib/ai-quota';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Chuẩn hoá finding, trả kết quả theo kiểu chảy dần.
 *
 * Định dạng NDJSON — mỗi dòng một đối tượng JSON:
 *
 *   {"type":"delta","text":"..."}   mẩu JSON model vừa sinh, ghép dồn để đọc dần
 *   {"type":"done","result":{...}}  bản chính thức đã qua Zod và hậu kiểm
 *   {"type":"error","error":"..."}  hỏng giữa chừng
 *
 * Chọn NDJSON thay vì SSE vì phía trình duyệt chỉ cần đọc `res.body` rồi tách
 * theo dấu xuống dòng — không phải kéo thêm thư viện, và `fetch` vẫn gửi được
 * POST kèm dữ liệu (EventSource thì không).
 *
 * Lỗi phát sinh SAU khi đã bắt đầu truyền thì không đổi được mã HTTP nữa, nên
 * chúng đi vào dòng `error` trong thân phản hồi. Chỉ lỗi xảy ra trước lúc
 * truyền mới trả mã lỗi HTTP thật.
 *
 * ────────────────────────────────────────────────────────────────────
 * BỐN CỬA PHẢI QUA TRƯỚC KHI ĐỘNG TỚI TIỀN API — đúng theo thứ tự này:
 *
 *   1. Dữ liệu gửi lên có hợp lệ không   → 400
 *   2. Người gọi là ai                   → 401   (trước đây KHÔNG có cửa này:
 *                                                 ai biết URL cũng gọi được)
 *   3. Đợt còn mở không                  → 409
 *   4. Còn lượt trong giờ này không      → 429
 *
 * Cửa 1 phải đứng trước cửa 2, vì đọc được `auditId` trong thân request thì
 * mới biết đường tra cookie của đợt nào.
 * ────────────────────────────────────────────────────────────────────
 */
export async function POST(req: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: 'Chưa cấu hình ANTHROPIC_API_KEY.' }, { status: 503 });
  }

  /* --- Cửa 1: dữ liệu hợp lệ --- */
  const parsed = standardizeRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { auditId, ...input } = parsed.data;

  /* --- Cửa 2: anh là ai --- */
  const actor = await resolveAiActor(auditId);
  if (!actor) {
    return NextResponse.json(
      { error: 'Chưa đăng nhập vào đợt đánh giá. Vui lòng mở lại link đợt và nhập mã.' },
      { status: 401 },
    );
  }

  /* --- Cửa 3: đợt còn mở --- */
  if (actor.auditClosed) {
    return NextResponse.json({ error: 'Đợt đã khoá, không chuẩn hoá thêm được.' }, { status: 409 });
  }

  /* --- Cửa 4: còn lượt --- */
  const quota = await checkAiQuota(actor.key);
  if (!quota.ok) {
    return NextResponse.json(
      { error: quota.message },
      { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const event of standardizeFindingStream(input)) {
          /**
           * CHỈ TÍNH LƯỢT KHI AI THỰC SỰ TRẢ VỀ KẾT QUẢ. Lời gọi hỏng giữa
           * chừng không trừ vào hạn mức — người dùng chưa nhận được gì mà đã
           * mất lượt thì rất ức chế, và họ sẽ bấm lại ngay, càng tốn thêm.
           *
           * Gửi kèm số lượt còn lại để giao diện cảnh báo sớm, thay vì để
           * người dùng bất ngờ đụng trần.
           */
          if (event.type === 'done') {
            await recordAiUsage(actor, 'standardize');
            send({ ...event, quota: { remaining: quota.remaining - 1, limit: AI_HOURLY_LIMIT } });
            continue;
          }
          send(event);
        }
      } catch (e) {
        console.error('[standardize]', e);
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
      // Chặn tầng proxy gom dữ liệu lại rồi mới đẩy đi — gom là mất hết ý nghĩa.
      'X-Accel-Buffering': 'no',
    },
  });
}
