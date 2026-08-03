import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1, 'Nhập tên đơn vị'),
  note: z.string().trim().optional(),
});

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  const rows = await db
    .select()
    .from(auditUnits)
    .where(eq(auditUnits.auditId, id))
    .orderBy(asc(auditUnits.createdAt));
  return NextResponse.json({ units: rows });
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

  const existing = await db.select().from(auditUnits).where(eq(auditUnits.auditId, id));
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (existing.some((u) => norm(u.name) === norm(parsed.data.name))) {
    return NextResponse.json({ error: 'Đơn vị này đã có trong danh sách.' }, { status: 409 });
  }

  try {
    const [row] = await db
      .insert(auditUnits)
      .values({ auditId: id, name: parsed.data.name, note: parsed.data.note || null })
      .returning();
    return NextResponse.json({ unit: row }, { status: 201 });
  } catch (e) {
    console.error('[units:POST]', e);
    return NextResponse.json({ error: 'Không thêm được đơn vị.' }, { status: 500 });
  }
}
