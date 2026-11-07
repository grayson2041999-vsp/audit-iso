import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { DEFAULT_RANGES } from '@/lib/plan';

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

const createSchema = z.object({
  organization: z.string().trim().min(1, 'Nhập tên tổ chức được đánh giá'),
  title: z.string().trim().min(1, 'Nhập tên đợt đánh giá'),
  scope: z.string().optional(),
  standards: z.array(z.string()).min(1, 'Chọn ít nhất một tiêu chuẩn'),
  leadAuditor: z.string().trim().min(1, 'Nhập tên trưởng đoàn'),
  /** Ngày thực hiện, không cần liền nhau. Giờ làm việc lấy mặc định, chỉnh ở tab Chương trình. */
  days: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ'))
    .min(1, 'Chọn ít nhất một ngày thực hiện')
    .max(60, 'Tối đa 60 ngày thực hiện'),
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
  const days = [...new Set(d.days)].sort();

  try {
    const [row] = await db
      .insert(audits)
      .values({
        leaderId: leader.id,
        organization: d.organization,
        title: d.title,
        scope: d.scope || null,
        standards: d.standards,
        leadAuditor: d.leadAuditor,
        auditDays: days.map((date) => ({ date, ranges: DEFAULT_RANGES.map((r) => ({ ...r })) })),
        // Hai cột ngày đầu / ngày cuối luôn khớp theo danh sách ngày.
        startDate: new Date(days[0]),
        endDate: new Date(days[days.length - 1]),
        // Đang chuẩn bị — đợt chỉ mở khi sinh mã cho đánh giá viên
        status: 'PLANNED',
      })
      .returning();

    return NextResponse.json({ audit: row }, { status: 201 });
  } catch (e) {
    console.error('[audits:POST]', e);
    return NextResponse.json({ error: 'Không tạo được đợt đánh giá.' }, { status: 500 });
  }
}
