import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leaders } from '@/lib/schema';
import { verifyPassword, startSession, isAuthConfigured } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
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

  try {
    const [row] = await db.select().from(leaders).where(eq(leaders.email, parsed.data.email));

    // Cùng một thông báo cho "sai email" và "sai mật khẩu" — không tiết lộ
    // email nào đã tồn tại trong hệ thống.
    const ok = row && verifyPassword(parsed.data.password, row.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Email hoặc mật khẩu không đúng.' }, { status: 401 });
    }

    await startSession(row.id);
    return NextResponse.json({ leader: { id: row.id, fullName: row.fullName } });
  } catch (e) {
    console.error('[auth:dang-nhap]', e);
    return NextResponse.json({ error: 'Không đăng nhập được.' }, { status: 500 });
  }
}
