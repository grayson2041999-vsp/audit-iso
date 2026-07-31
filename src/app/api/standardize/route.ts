import { NextResponse } from 'next/server';
import { standardizeRequestSchema } from '@/lib/types';
import { standardizeFinding, isAiConfigured } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

  try {
    const { result, model, warnings } = await standardizeFinding(parsed.data);
    return NextResponse.json({ result, model, warnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lỗi không xác định khi gọi AI.';
    console.error('[standardize]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
