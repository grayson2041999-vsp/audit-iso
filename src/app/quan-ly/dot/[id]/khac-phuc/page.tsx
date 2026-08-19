import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits, correctiveItems, correctiveReports } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import {
  CAPA_LABEL_LEADER, CAPA_STYLE, waitingOnLeader, type CapaStatus,
} from '@/lib/capa';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();
  const { audit } = owned;

  if (!audit.issuedAt) {
    return (
      <div className="space-y-6">
        <Link href={`/quan-ly/dot/${id}/tong-hop`} className="text-sm text-slate-500 hover:underline">
          ← Tổng hợp finding
        </Link>
        <div className="card p-6 text-sm text-slate-500">
          Chưa gửi báo cáo cho đơn vị nào. Sang tab Tổng hợp finding để gửi.
        </div>
      </div>
    );
  }

  const [units, reports, items] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
    db.select().from(correctiveReports).where(eq(correctiveReports.auditId, id)),
    db
      .select({ reportId: correctiveItems.reportId, verdict: correctiveItems.verdict, isActive: correctiveItems.isActive })
      .from(correctiveItems)
      .innerJoin(correctiveReports, eq(correctiveReports.id, correctiveItems.reportId))
      .where(eq(correctiveReports.auditId, id)),
  ]);

  const reportByUnit = new Map(reports.map((r) => [r.unitId, r]));
  const itemCount = new Map<string, number>();
  for (const it of items) {
    if (!it.isActive) continue;
    itemCount.set(it.reportId, (itemCount.get(it.reportId) ?? 0) + 1);
  }

  const pending = reports.filter((r) => waitingOnLeader(r.status as CapaStatus)).length;
  const closed = reports.filter((r) => r.status === 'CLOSED').length;

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <AuditHeader audit={audit} />
      <AuditTabs auditId={id} issued />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Đơn vị phải khắc phục" value={reports.length} />
        <Stat label="Chờ bạn xử lý" value={pending} tone={pending > 0 ? 'warn' : 'muted'} />
        <Stat label="Đã đóng" value={closed} tone={closed > 0 ? 'ok' : 'muted'} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Đơn vị</th>
              <th className="px-4 py-3 text-center">Số NC</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Người chịu trách nhiệm</th>
              <th className="px-4 py-3">Cập nhật</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {units.map((u) => {
              const r = reportByUnit.get(u.id);

              // Đơn vị không có NC nào — vẫn xem được báo cáo, chỉ là không phải nộp gì.
              if (!r) {
                return (
                  <tr key={u.id} className="text-slate-400">
                    <td className="px-4 py-3">{u.name}</td>
                    <td className="px-4 py-3 text-center">—</td>
                    <td className="px-4 py-3" colSpan={4}>
                      Không có sự không phù hợp
                    </td>
                  </tr>
                );
              }

              const status = r.status as CapaStatus;
              return (
                <tr key={u.id} className={waitingOnLeader(status) ? 'bg-amber-50/40' : ''}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {itemCount.get(r.id) ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('chip whitespace-nowrap', CAPA_STYLE[status])}>
                      {CAPA_LABEL_LEADER[status]}
                    </span>
                    {r.round > 1 && (
                      <span className="ml-2 text-xs text-slate-400">lần {r.round}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.responsibleName ? (
                      <>
                        {r.responsibleName}
                        {r.responsibleTitle && (
                          <span className="text-slate-400"> · {r.responsibleTitle}</span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(r.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/quan-ly/dot/${id}/khac-phuc/${u.id}`}
                      className="text-sm text-brand-700 hover:underline"
                    >
                      {waitingOnLeader(status) ? 'Xử lý' : 'Xem'}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: number;
  tone?: 'muted' | 'warn' | 'ok';
}) {
  const color =
    tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-400';
  return (
    <div className="card p-4 text-center">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', color)}>{value}</p>
    </div>
  );
}
