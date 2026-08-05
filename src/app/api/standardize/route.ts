import { NextResponse } from 'next/server';
import { standardizeRequestSchema } from '@/lib/types';
import { standardizeFindingStream, isAiConfigured } from '@/lib/ai';

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
 */
export async function POST(req: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: 'Chưa cấu hình ANTHROPIC_API_KEY.' }, { status: 503 });
  }

  const parsed = standardizeRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const event of standardizeFindingStream(parsed.data)) send(event);
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
