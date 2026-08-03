import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits, findings } from '@/lib/schema';
import { getMember, getMemberUnitIds } from '@/lib/member-auth';
import { MemberBar } from '@/components/MemberBar';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getMember(id);
  if (!session) redirect(`/dot/${id}`);
  const { member, audit } = session;

  const unitIds = await getMemberUnitIds(id, member.id);

  const units = unitIds.length
    ? await db.select().from(auditUnits).where(inArray(auditUnits.id, unitIds))
    : [];

  const mine = await db
    .select({ unitId: findings.unitId, status: findings.status })
    .from(findings)
    .where(and(eq(findings.auditId, id), eq(findings.memberId, member.id)));

  const countFor = (unitId: string) => {
    const rows = mine.filter((f) => f.unitId === unitId);
    return { total: rows.length, draft: rows.filter((f) => f.status === 'DRAFT').length };
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <MemberBar auditId={id} auditTitle={audit.title} memberName={member.fullName} />

      <div>
        <h1 className="text-2xl font-semibold">Đơn vị bạn được giao</h1>
        <p className="mt-1 text-sm text-slate-500">
          {units.length} đơn vị · {mine.length} finding đã ghi nhận
        </p>
      </div>

      {units.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">
          Bạn chưa được phân công đơn vị nào. Liên hệ trưởng đoàn.
        </div>
      ) : (
        <ul className="grid gap-3">
          {units.map((u) => {
            const c = countFor(u.id);
            return (
              <li key={u.id}>
                <Link
                  href={`/dot/${id}/don-vi/${u.id}`}
                  className="card flex items-center gap-4 p-5 transition hover:border-brand-300 hover:shadow"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{u.name}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {c.total === 0
                        ? 'Chưa ghi nhận finding nào'
                        : `${c.total} finding${c.draft > 0 ? ` · ${c.draft} bản nháp chưa nộp` : ''}`}
                    </p>
                  </div>
                  <span className="text-slate-300">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
