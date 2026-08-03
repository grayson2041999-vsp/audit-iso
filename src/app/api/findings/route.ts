import { NextResponse } from 'next/server';
import { desc, eq, and, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findings, findingImages } from '@/lib/schema';
import { createFindingSchema } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const status = url.searchParams.get('status');
  const severity = url.searchParams.get('severity');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const conds: SQL[] = [];
  if (status) conds.push(eq(findings.status, status as never));
  if (severity) conds.push(eq(findings.severity, severity as never));
  if (q) {
    const like = `%${q}%`;
    const c = or(ilike(findings.title, like), ilike(findings.rawText, like), ilike(findings.code, like));
    if (c) conds.push(c);
  }

  try {
    const rows = await db
      .select()
      .from(findings)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(findings.createdAt))
      .limit(limit);
    return NextResponse.json({ findings: rows });
  } catch (e) {
    console.error('[findings:GET]', e);
    return NextResponse.json({ error: 'Không truy vấn được cơ sở dữ liệu. Kiểm tra DATABASE_URL.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const parsed = createFindingSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const ai = d.ai;

  try {
    const [row] = await db
      .insert(findings)
      .values({
        auditId: d.auditId ?? null,
        code: d.code ?? null,
        status: ai ? 'AI_DRAFTED' : 'DRAFT',
        rawText: d.rawText,
        rawArea: d.area ?? null,
        rawProcess: d.process ?? null,
        auditee: d.auditee ?? null,
        auditorName: d.auditorName ?? null,
        observedAt: d.observedAt ? new Date(d.observedAt) : new Date(),
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        standards: d.standards,
        title: ai?.title ?? null,
        severity: ai?.severity ?? null,
        requirement: ai?.requirement ?? null,
        nonconformity: ai?.nonconformity ?? null,
        evidence: ai?.evidence ?? [],
        statement: ai?.statement ?? null,
        clauses: ai?.clauses.map((c) => ({
          standard: c.standard, clause: c.clause, clauseTitle: c.clauseTitle,
        })) ?? [],
        riskAnalysis: ai?.riskAnalysis ?? null,
        suggestedAction: ai?.suggestedAction ?? null,
        missingInfo: ai?.missingInfo ?? [],
        confidence: ai?.confidence ?? null,
        aiModel: ai ? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5' : null,
        aiRaw: ai ?? null,
      })
      .returning();

    if (d.images.length) {
      await db.insert(findingImages).values(
        d.images.map((img, i) => ({
          findingId: row.id,
          key: img.key,
          fileName: img.fileName ?? null,
          contentType: img.contentType ?? null,
          size: img.size ?? null,
          caption: ai?.imageNotes?.[i] ?? null,
        })),
      );
    }

    return NextResponse.json({ finding: row }, { status: 201 });
  } catch (e) {
    console.error('[findings:POST]', e);
    return NextResponse.json({ error: 'Không lưu được finding. Kiểm tra kết nối Neon.' }, { status: 500 });
  }
}
