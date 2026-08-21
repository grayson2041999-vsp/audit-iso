import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits, findings } from '@/lib/schema';
import { getMember, memberOwnsUnit } from '@/lib/member-auth';
import { MemberBar } from '@/components/MemberBar';
import { SeverityBadge } from '@/components/Badge';
import { formatDate, formatDateOnly } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id, unitId } = await params;

  const session = await getMember(id);
  if (!session) redirect(`/dot/${id}`);
  const { member, audit } = session;

  if (!(await memberOwnsUnit(id, member.id, unitId))) notFound();

  const [unit] = await db.select().from(auditUnits).where(eq(auditUnits.id, unitId));
  if (!unit) notFound();

  const rows = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.auditId, id),
        eq(findings.unitId, unitId),
        eq(findings.memberId, member.id),
      ),
    )
    .orderBy(desc(findings.createdAt));

  const closed = audit.status === 'CLOSED';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <MemberBar auditId={id} auditTitle={audit.title} memberName={member.fullName} />

      <Link href={`/dot/${id}/toi`} className="block text-sm text-slate-500 hover:underline">
        ← Đơn vị được giao
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{unit.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} finding bạn đã ghi nhận cho đơn vị này
          </p>
        </div>
        {!closed && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/dot/${id}/don-vi/${unitId}/checklist`} className="btn-ghost">
              Checklist đánh giá
            </Link>
            <Link href={`/dot/${id}/don-vi/${unitId}/moi`} className="btn-primary">
              + Ghi nhận mới
            </Link>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Chưa có finding nào cho đơn vị này.
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((f) => (
            <li key={f.id}>
              <Link
                href={`/dot/${id}/finding/${f.id}`}
                className="card block p-4 transition hover:border-brand-300 hover:shadow"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{f.code}</span>
                  <SeverityBadge value={f.severity} />
                  {f.status === 'DRAFT' ? (
                    <span className="chip bg-amber-100 text-amber-800 ring-transparent">
                      Bản nháp — chưa nộp
                    </span>
                  ) : (
                    <span className="chip bg-emerald-100 text-emerald-800 ring-transparent">
                      Đã nộp
                    </span>
                  )}
                </div>
                <p className="font-medium">{f.title ?? f.rawText.slice(0, 80) + '…'}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {f.rawArea ? `${f.rawArea} · ` : ''}
                  {formatDate(f.createdAt)}
                  {f.dueDate ? ` · Hạn khắc phục ${formatDateOnly(f.dueDate)}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
