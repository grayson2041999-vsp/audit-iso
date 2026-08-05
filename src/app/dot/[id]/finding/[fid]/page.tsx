import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findingImages, findings } from '@/lib/schema';
import { getMember } from '@/lib/member-auth';
import { MemberBar } from '@/components/MemberBar';
import { MemberFindingActions } from '@/components/MemberFindingActions';
import { FindingEditor } from '@/components/FindingEditor';
import { StandardizeLater } from '@/components/StandardizeLater';
import { SeverityBadge } from '@/components/Badge';
import { presignDownload, isR2Configured } from '@/lib/r2';
import { formatDate, formatDateOnly, dueStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; fid: string }>;
}) {
  const { id, fid } = await params;

  const session = await getMember(id);
  if (!session) redirect(`/dot/${id}`);
  const { member, audit } = session;

  const [row] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.id, fid), eq(findings.auditId, id)));

  if (!row || row.memberId !== member.id) notFound();

  const imgs = await db.select().from(findingImages).where(eq(findingImages.findingId, fid));
  const images = await Promise.all(
    imgs.map(async (i) => ({
      ...i,
      url: isR2Configured() ? await presignDownload(i.key) : null,
    })),
  );

  const isDraft = row.status === 'DRAFT';
  const standardized = Boolean(row.statement);
  /**
   * Editor đang mở hay không — quyết định luôn việc có hiện khối điều khoản
   * chỉ-xem ở cột phải. Editor đã sửa được điều khoản nên hiện thêm một bản
   * chỉ-xem sẽ thành hai chỗ cùng một dữ liệu, không rõ chỗ nào có tác dụng.
   */
  const editing = isDraft && standardized && audit.status !== 'CLOSED';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <MemberBar auditId={id} auditTitle={audit.title} memberName={member.fullName} />

      {row.unitId && (
        <Link
          href={`/dot/${id}/don-vi/${row.unitId}`}
          className="block text-sm text-slate-500 hover:underline"
        >
          ← {row.auditee ?? 'Đơn vị'}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{row.code}</span>
            <SeverityBadge value={row.severity} />
            {isDraft ? (
              <span className="chip bg-amber-100 text-amber-800 ring-transparent">
                {standardized ? 'Bản nháp — chưa nộp' : 'Bản nháp — chưa chuẩn hoá'}
              </span>
            ) : (
              <span className="chip bg-emerald-100 text-emerald-800 ring-transparent">
                Đã nộp {row.submittedAt ? formatDate(row.submittedAt) : ''}
              </span>
            )}
          </div>
          <h1 className="max-w-2xl text-2xl font-semibold">
            {row.title ?? 'Finding chưa chuẩn hoá'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {row.auditee ?? '—'} · {row.rawArea ?? '—'} · {formatDate(row.createdAt)}
          </p>
        </div>

        <MemberFindingActions
          auditId={id}
          findingId={row.id}
          unitId={row.unitId}
          status={row.status}
          statement={row.statement ?? ''}
          canSubmit={standardized}
          auditClosed={audit.status === 'CLOSED'}
        />
      </div>

      {isDraft && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Finding này chưa nộp nên trưởng đoàn chưa thấy. Sửa trực tiếp bên dưới, xong thì
          bấm <strong>Nộp cho trưởng đoàn</strong>.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {isDraft && !standardized ? (
            <StandardizeLater
              auditId={id}
              findingId={row.id}
              hasImages={images.length > 0}
            />
          ) : isDraft ? (
            <FindingEditor
              endpoint={`/api/dot/${id}/findings/${row.id}`}
              backHref={`/dot/${id}/don-vi/${row.unitId ?? ''}`}
              canEditStatus={false}
              disabledReason={
                audit.status === 'CLOSED' ? 'Đợt đã khoá, không sửa được nữa.' : null
              }
              finding={{
                id: row.id,
                code: row.code,
                status: row.status,
                title: row.title,
                severity: row.severity,
                statement: row.statement,
                evidence: row.evidence,
                clauses: row.clauses,
                standards: row.standards,
                rawArea: row.rawArea,
                dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
              }}
            />
          ) : (
            <>
              <Section title="Phát biểu finding">
                <p className="whitespace-pre-wrap leading-relaxed">{row.statement ?? '—'}</p>
              </Section>

              <Section title="Bằng chứng khách quan">
                <ul className="space-y-1.5 text-sm">
                  {row.evidence.length ? (
                    row.evidence.map((e, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-slate-400">{i + 1}.</span>
                        {e}
                      </li>
                    ))
                  ) : (
                    <li className="text-slate-400">—</li>
                  )}
                </ul>
              </Section>
            </>
          )}

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
                      <figcaption className="px-2 py-1.5 text-xs text-slate-600">
                        {img.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </Section>
          )}

          <Section title="Ghi nhận gốc của bạn">
            <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-slate-600">
              {row.rawText}
            </p>
          </Section>
        </div>

        <div className="space-y-6">
          {!editing && (
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
          )}

          <Section title="Thời hạn khắc phục">
            {row.dueDate ? (
              <>
                <p className="font-medium">{formatDateOnly(row.dueDate)}</p>
                {(() => {
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
              <p className="text-sm text-slate-400">Không đặt hạn</p>
            )}
          </Section>

          {row.missingInfo.length > 0 && (
            <Section title="Cần bổ sung">
              <ul className="space-y-1 text-sm text-amber-800">
                {row.missingInfo.map((m, i) => (
                  <li key={i}>• {m}</li>
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
