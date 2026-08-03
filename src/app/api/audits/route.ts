import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';
import { getLeader } from '@/lib/auth';

export const runtime = 'nodejs';

/** Chỉ trả về đợt của trưởng đoàn đang đăng nhập. */
export async function GET() {
  const leader = await getLeader();
  if (!leader) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  try {
    const rows = await db
      .select()
      .from(audits)
      .where(eq(audits.leaderId, leader.id))
      .orderBy(desc(audits.createdAt));
    return NextResponse.json({ audits: rows });
  } catch (e) {
    console.error('[audits:GET]', e);
    return NextResponse.json({ error: 'Không truy vấn được cơ sở dữ liệu.' }, { status: 500 });
  }
}

const createSchema = z
  .object({
    code: z.string().trim().min(1, 'Nhập mã đợt'),
    title: z.string().trim().min(1, 'Nhập tên đợt đánh giá'),
    scope: z.string().optional(),
    standards: z.array(z.string()).min(1, 'Chọn ít nhất một tiêu chuẩn'),
    leadAuditor: z.string().trim().min(1, 'Nhập tên trưởng đoàn'),
    startDate: z.string().min(1, 'Chọn ngày bắt đầu'),
    endDate: z.string().min(1, 'Chọn ngày kết thúc'),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
    path: ['endDate'],
  });

export async function POST(req: Request) {
  const leader = await getLeader();
  if (!leader) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const d = parsed.data;

  try {
    const [row] = await db
      .insert(audits)
      .values({
        leaderId: leader.id,
        code: d.code,
        title: d.title,
        scope: d.scope || null,
        standards: d.standards,
        leadAuditor: d.leadAuditor,
        startDate: new Date(d.startDate),
        endDate: new Date(d.endDate),
        // Đang chuẩn bị — đợt chỉ mở khi sinh mã cho đánh giá viên (đợt 2)
        status: 'PLANNED',
      })
      .returning();

    return NextResponse.json({ audit: row }, { status: 201 });
  } catch (e) {
    console.error('[audits:POST]', e);
    return NextResponse.json({ error: 'Không tạo được đợt đánh giá.' }, { status: 500 });
  }
}
