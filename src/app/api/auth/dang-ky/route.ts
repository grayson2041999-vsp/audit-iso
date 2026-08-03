import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leaders } from '@/lib/schema';
import { hashPassword, startSession, isAuthConfigured } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Nhập họ tên'),
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
});

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: 'Chưa cấu hình AUTH_SECRET trong biến môi trường.' },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { fullName, email, password } = parsed.data;

  try {
    const [existing] = await db.select().from(leaders).where(eq(leaders.email, email));
    if (existing) {
      return NextResponse.json({ error: 'Email này đã được đăng ký.' }, { status: 409 });
    }

    const [row] = await db
      .insert(leaders)
      .values({ fullName, email, passwordHash: hashPassword(password) })
      .returning();

    await startSession(row.id);
    return NextResponse.json({ leader: { id: row.id, fullName: row.fullName } }, { status: 201 });
  } catch (e) {
    console.error('[auth:dang-ky]', e);
    return NextResponse.json({ error: 'Không tạo được tài khoản.' }, { status: 500 });
  }
}
