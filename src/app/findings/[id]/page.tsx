import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findings, findingImages } from '@/lib/schema';
import { SeverityBadge, StatusBadge } from '@/components/Badge';
import { presignDownload, isR2Configured } from '@/lib/r2';
import { formatDate, formatDateOnly, dueStatus } from '@/lib/utils';
import { FindingActions } from '@/components/FindingActions';

export const dynamic = 'force-dynamic';

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let row: typeof findings.$inferSelect | undefined;
  let images: { id: string; key: string; fileName: string | null; caption: string | null; url: string | null }[] = [];

  try {
    [row] = await db.select().from(findings).where(eq(findings.id, id));
    if (row) {
      const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, id));
      images = await Promise.all(
        imgs.map(async (i) => ({
          id: i.id, key: i.key, fileName: i.fileName, caption: i.caption,
          url: isR2Configured() ? await presignDownload(i.key) : null,
        })),
      );
    }
  } catch {
    /* hiển thị lỗi bên dưới */
  }

  if (!row) notFound();

  return (
    <div className="space-y-6">
      <Link href="/findings" className="text-sm text-slate-500 hover:underline">← Danh sách finding</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SeverityBadge value={row.severity} />
            <StatusBadge value={row.status} />
            {row.code && <span className="font-mono text-xs text-slate-500">{row.code}</span>}
          </div>
          <h1 className="max-w-3xl text-2xl font-semibold">{row.title ?? 'Finding chưa chuẩn hoá'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {row.auditee ?? '—'} · {row.rawArea ?? '—'} · {row.rawProcess ?? '—'} · Auditor:{' '}
            {row.auditorName ?? '—'} · {formatDate(row.createdAt)}
          </p>
        </div>
        <FindingActions id={row.id} status={row.status} statement={row.statement ?? ''} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Phát biểu finding">
            <p className="whitespace-pre-wrap leading-relaxed">{row.statement ?? '—'}</p>
          </Section>

          <Section title="Bằng chứng khách quan">
            <ul className="space-y-1.5 text-sm">
              {row.evidence.length ? row.evidence.map((e, i) => (
                <li key={i} className="flex gap-2"><span className="text-slate-400">{i + 1}.</span>{e}</li>
              )) : <li className="text-slate-400">—</li>}
            </ul>
          </Section>

          {images.length > 0 && (
            <Section title={`Hình ảnh hiện trường (${images.length})`}>
              <div className="grid gap-3 sm:grid-cols-3">
                {images.map((img) => (
                  <figure key={img.id} className="overflow-hidden rounded-lg border border-slate-200">
                    {img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url} alt={img.fileName ?? ''} className="h-36 w-full object-cover" />
                    ) : (
                      <div className="grid h-36 place-items-center bg-slate-100 text-xs text-slate-400">
                        Chưa cấu hình R2
                      </div>
                    )}
                    {img.caption && (
                      <figcaption className="px-2 py-1.5 text-xs text-slate-600">{img.caption}</figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </Section>
          )}

          <Section title="Ghi nhận gốc của auditor">
            <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-slate-600">{row.rawText}</p>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Điều khoản viện dẫn">
            <ul className="space-y-2">
              {row.clauses.length ? row.clauses.map((c, i) => (
                <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-medium text-brand-700">{c.standard} — {c.clause}</p>
                  <p className="text-xs text-slate-600">{c.clauseTitle}</p>
                </li>
              )) : <li className="text-sm text-slate-400">—</li>}
            </ul>
          </Section>

          <Section title="Thông tin xử lý">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Đơn vị được đánh giá</dt>
                <dd className="text-right font-medium">{row.auditee ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Nơi phát hiện</dt>
                <dd className="text-right font-medium">{row.rawArea ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Thời hạn khắc phục</dt>
                <dd className="text-right">
                  {row.dueDate ? (
                    <>
                      <span className="font-medium">{formatDateOnly(row.dueDate)}</span>
                      {row.status !== 'CLOSED' &&
                        (() => {
                          const { days, tone } = dueStatus(row.dueDate!);
                          return (
                            <p
                              className={
                                tone === 'overdue'
                                  ? 'text-xs font-medium text-red-600'
                                  : tone === 'soon'
                                    ? 'text-xs font-medium text-amber-600'
                                    : 'text-xs text-slate-500'
                              }
                            >
                              {days < 0
                                ? `Quá hạn ${-days} ngày`
                                : days === 0
                                  ? 'Đến hạn hôm nay'
                                  : `Còn ${days} ngày`}
                            </p>
                          );
                        })()}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
          </Section>

          {row.missingInfo.length > 0 && (
            <Section title="Cần bổ sung">
              <ul className="space-y-1 text-sm text-amber-800">
                {row.missingInfo.map((m, i) => <li key={i}>• {m}</li>)}
              </ul>
            </Section>
          )}

          <Section title="Thông tin AI">
            <dl className="space-y-1 text-sm text-slate-600">
              <div className="flex justify-between"><dt>Mô hình</dt><dd className="font-mono text-xs">{row.aiModel ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Tiêu chuẩn</dt><dd>{row.standards.join(', ')}</dd></div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
