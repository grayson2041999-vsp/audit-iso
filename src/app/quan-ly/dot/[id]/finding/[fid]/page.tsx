import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findingImages, findingRevisions, findings } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { LeaderFindingEditor } from '@/components/LeaderFindingEditor';
import { presignDownload, isR2Configured } from '@/lib/r2';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; fid: string }>;
}) {
  const { id, fid } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();

  const [row] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.id, fid), eq(findings.auditId, id)));
  if (!row) notFound();

  const [imgs, revisions] = await Promise.all([
    db.select().from(findingImages).where(eq(findingImages.findingId, fid)),
    db
      .select()
      .from(findingRevisions)
      .where(eq(findingRevisions.findingId, fid))
      .orderBy(desc(findingRevisions.createdAt))
      .limit(10),
  ]);

  const images = await Promise.all(
    imgs.map(async (i) => ({
      ...i,
      url: isR2Configured() ? await presignDownload(i.key) : null,
    })),
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/quan-ly/dot/${id}/tong-hop`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← Bảng tổng hợp
      </Link>

      <div>
        <p className="font-mono text-xs text-slate-500">{row.code}</p>
        <h1 className="mt-1 text-2xl font-semibold">{row.title ?? 'Finding chưa chuẩn hoá'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {row.auditee ?? '—'} · Ghi nhận bởi {row.auditorName ?? '—'} · {formatDate(row.createdAt)}
          {row.submittedAt ? ` · Nộp ${formatDate(row.submittedAt)}` : ''}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LeaderFindingEditor
            auditId={id}
            auditClosed={owned.audit.status === 'CLOSED'}
            finding={{
              id: row.id,
              code: row.code,
              status: row.status,
              title: row.title,
              severity: row.severity,
              statement: row.statement,
              evidence: row.evidence,
              clauses: row.clauses,
              rawArea: row.rawArea,
              dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
            }}
          />
        </div>

        <div className="space-y-6">
          <Section title="Điều khoản viện dẫn">
            <ul className="space-y-2">
              {row.clauses.length ? (
                row.clauses.map((c, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-medium text-brand-700">
                      {c.standard} — {c.clause}
                    </p>
                    <p className="text-xs text-slate-600">{c.clauseTitle}</p>
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-400">—</li>
              )}
            </ul>
          </Section>

          {images.length > 0 && (
            <Section title={`Hình ảnh (${images.length})`}>
              <div className="grid gap-3 sm:grid-cols-2">
                {images.map((img) => (
                  <figure key={img.id} className="overflow-hidden rounded-lg border border-slate-200">
                    {img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url} alt={img.fileName ?? ''} className="h-28 w-full object-cover" />
                    ) : (
                      <div className="grid h-28 place-items-center bg-slate-100 text-xs text-slate-400">
                        Chưa cấu hình R2
                      </div>
                    )}
                    {img.caption && (
                      <figcaption className="px-2 py-1.5 text-xs text-slate-600">
                        {img.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </Section>
          )}

          <Section title="Ghi nhận gốc">
            <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-slate-600">
              {row.rawText}
            </p>
          </Section>

          {row.missingInfo.length > 0 && (
            <Section title="AI đề nghị bổ sung">
              <ul className="space-y-1 text-sm text-amber-800">
                {row.missingInfo.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
              </ul>
            </Section>
          )}

          {revisions.length > 0 && (
            <Section title="Lịch sử chỉnh sửa">
              <ul className="space-y-1.5 text-sm text-slate-600">
                {revisions.map((r) => (
                  <li key={r.id}>
                    <span className="text-slate-400">{formatDate(r.createdAt)}</span> ·{' '}
                    {r.editor ?? '—'} · {r.note ?? ''}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}
