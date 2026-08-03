import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditMembers, audits } from '@/lib/schema';
import { startMemberSession } from '@/lib/member-auth';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  memberId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{6}$/, 'Mã gồm đúng 6 chữ số'),
});

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  try {
    const [audit] = await db.select().from(audits).where(eq(audits.id, id));
    if (!audit) return NextResponse.json({ error: 'Không tìm thấy đợt đánh giá.' }, { status: 404 });
    if (audit.status === 'PLANNED') {
      return NextResponse.json({ error: 'Đợt đánh giá chưa được mở.' }, { status: 409 });
    }

    const [member] = await db
      .select()
      .from(auditMembers)
      .where(and(eq(auditMembers.id, parsed.data.memberId), eq(auditMembers.auditId, id)));

    if (!member || !member.accessCode || member.accessCode !== parsed.data.code) {
      return NextResponse.json({ error: 'Mã không đúng.' }, { status: 401 });
    }

    await startMemberSession(id, member.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[dot:vao]', e);
    return NextResponse.json({ error: 'Không vào được đợt đánh giá.' }, { status: 500 });
  }
}
