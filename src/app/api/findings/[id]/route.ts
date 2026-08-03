import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findings, findingImages, findingRevisions } from '@/lib/schema';
import { updateFindingSchema } from '@/lib/types';
import { presignDownload, deleteObject, isR2Configured } from '@/lib/r2';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const [row] = await db.select().from(findings).where(eq(findings.id, id));
    if (!row) return NextResponse.json({ error: 'Không tìm thấy finding.' }, { status: 404 });

    const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, id));
    const images = await Promise.all(
      imgs.map(async (i) => ({
        ...i,
        url: isR2Configured() ? await presignDownload(i.key) : null,
      })),
    );

    return NextResponse.json({ finding: row, images });
  } catch (e) {
    console.error('[finding:GET]', e);
    return NextResponse.json({ error: 'Lỗi truy vấn cơ sở dữ liệu.' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = updateFindingSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ', issues: parsed.error.issues }, { status: 400 });
  }

  const { editor, note, dueDate, ...rest } = parsed.data;

  // dueDate tới dưới dạng chuỗi "YYYY-MM-DD", cột trong DB là timestamptz.
  const patch = {
    ...rest,
    ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
  };

  try {
    const [before] = await db.select().from(findings).where(eq(findings.id, id));
    if (!before) return NextResponse.json({ error: 'Không tìm thấy finding.' }, { status: 404 });

    await db.insert(findingRevisions).values({
      findingId: id,
      editor: editor ?? null,
      note: note ?? 'Cập nhật thủ công',
      snapshot: before,
    });

    const [row] = await db
      .update(findings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(findings.id, id))
      .returning();

    return NextResponse.json({ finding: row });
  } catch (e) {
    console.error('[finding:PATCH]', e);
    return NextResponse.json({ error: 'Không cập nhật được finding.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, id));
    if (isR2Configured()) {
      await Promise.allSettled(imgs.map((i) => deleteObject(i.key)));
    }
    await db.delete(findings).where(eq(findings.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[finding:DELETE]', e);
    return NextResponse.json({ error: 'Không xoá được finding.' }, { status: 500 });
  }
}
