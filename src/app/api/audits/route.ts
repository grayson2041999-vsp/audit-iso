import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rows = await db.select().from(audits).orderBy(desc(audits.createdAt)).limit(100);
    return NextResponse.json({ audits: rows });
  } catch {
    return NextResponse.json({ audits: [] });
  }
}

const createSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  scope: z.string().optional(),
  standards: z.array(z.string()).default([]),
  auditee: z.string().optional(),
  leadAuditor: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ' }, { status: 400 });
  }
  try {
    const [row] = await db.insert(audits).values(parsed.data).returning();
    return NextResponse.json({ audit: row }, { status: 201 });
  } catch (e) {
    console.error('[audits:POST]', e);
    return NextResponse.json({ error: 'Không tạo được cuộc đánh giá.' }, { status: 500 });
  }
}
