import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditMembers } from '@/lib/schema';
import { getOwnedAudit, generateAccessCode } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  fullName: z.string().trim().min(2, 'Nhập họ tên đánh giá viên'),
  homeUnit: z.string().trim().optional(),
  isLeader: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const rows = await db
    .select()
    .from(auditMembers)
    .where(eq(auditMembers.auditId, id))
    .orderBy(asc(auditMembers.createdAt));
  return NextResponse.json({ members: rows });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (owned.audit.status === 'CLOSED') {
    return NextResponse.json({ error: 'Đợt đã khoá, không sửa được.' }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const existing = await db.select().from(auditMembers).where(eq(auditMembers.auditId, id));
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (existing.some((m) => norm(m.fullName) === norm(parsed.data.fullName))) {
    return NextResponse.json(
      { error: 'Đã có đánh giá viên trùng tên. Thêm chức danh hoặc tên đệm để phân biệt.' },
      { status: 409 },
    );
  }

  // Đợt đã mở thì người thêm sau được cấp mã ngay, không phải mở lại đợt.
  const alreadyOpen = owned.audit.status !== 'PLANNED';
  const taken = new Set(existing.map((m) => m.accessCode).filter(Boolean) as string[]);

  try {
    const [row] = await db
      .insert(auditMembers)
      .values({
        auditId: id,
        fullName: parsed.data.fullName,
        homeUnit: parsed.data.homeUnit || null,
        isLeader: parsed.data.isLeader ? '1' : '0',
        accessCode: alreadyOpen ? generateAccessCode(taken) : null,
      })
      .returning();
    return NextResponse.json({ member: row }, { status: 201 });
  } catch (e) {
    console.error('[members:POST]', e);
    return NextResponse.json({ error: 'Không thêm được đánh giá viên.' }, { status: 500 });
  }
}
