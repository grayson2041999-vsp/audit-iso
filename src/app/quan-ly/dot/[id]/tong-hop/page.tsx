import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditMembers, auditUnits, findings } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import { FindingFilters } from '@/components/FindingFilters';
import { AuditLockButton } from '@/components/AuditLockButton';
import { SeverityBadge } from '@/components/Badge';
import { formatDateOnly, dueStatus } from '@/lib/utils';
import { SEVERITY_LABELS } from '@/lib/iso';

export const dynamic = 'force-dynamic';

const FINDING_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Bản nháp', cls: 'bg-amber-100 text-amber-800' },
  SUBMITTED: { label: 'Đã nộp', cls: 'bg-emerald-100 text-emerald-800' },
  REVIEWED: { label: 'Đã rà soát', cls: 'bg-blue-100 text-blue-800' },
  CLOSED: { label: 'Đã đóng', cls: 'bg-zinc-200 text-zinc-700' },
  AI_DRAFTED: { label: 'Bản nháp', cls: 'bg-amber-100 text-amber-800' },
  ISSUED: { label: 'Đã phát hành', cls: 'bg-blue-100 text-blue-800' },
};

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();
  const { audit } = owned;

  const [units, members] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
    db.select().from(auditMembers).where(eq(auditMembers.auditId, id)).orderBy(asc(auditMembers.fullName)),
  ]);

  const conds: SQL[] = [eq(findings.auditId, id)];
  if (sp.unit) conds.push(eq(findings.unitId, sp.unit));
  if (sp.member) conds.push(eq(findings.memberId, sp.member));
  if (sp.severity) conds.push(eq(findings.severity, sp.severity as never));
  if (sp.status) conds.push(eq(findings.status, sp.status as never));

  const rows = await db
    .select()
    .from(findings)
    .where(and(...conds))
    .orderBy(desc(findings.createdAt));

  // Thống kê tính trên TOÀN đợt, không phụ thuộc bộ lọc đang bật.
  const all = await db.select().from(findings).where(eq(findings.auditId, id));
  const countBy = (sev: string) => all.filter((f) => f.severity === sev).length;
  const drafts = all.filter((f) => f.status === 'DRAFT').length;

  const query = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <AuditHeader audit={audit} />
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/audits/${id}/xuat-excel${query ? `?${query}` : ''}`}
            className="btn-ghost"
          >
            Xuất Excel
          </a>
          <AuditLockButton auditId={id} closed={audit.status === 'CLOSED'} />
        </div>
      </div>

      <AuditTabs auditId={id} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(['MAJOR', 'MINOR', 'OBS', 'OFI'] as const).map((s) => (
          <div key={s} className="card p-4">
            <p className="text-xs text-slate-500">{SEVERITY_LABELS[s]}</p>
            <p className="mt-1 text-2xl font-semibold">{countBy(s)}</p>
          </div>
        ))}
        <div className="card p-4">
          <p className="text-xs text-slate-500">Chưa nộp</p>
          <p className={`mt-1 text-2xl font-semibold ${drafts > 0 ? 'text-amber-600' : ''}`}>
            {drafts}
          </p>
        </div>
      </div>

      {drafts > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Còn {drafts} finding ở dạng bản nháp — đánh giá viên chưa nộp. Bảng dưới vẫn hiện
          để bạn nắm tiến độ, nhưng nội dung có thể còn thay đổi.
        </p>
      )}

      <FindingFilters
        units={units.map((u) => ({ id: u.id, label: u.name }))}
        members={members.map((m) => ({ id: m.id, label: m.fullName }))}
      />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1150px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3 whitespace-nowrap">Phân loại</th>
              <th className="px-4 py-3">Đơn vị được đánh giá</th>
              <th className="px-4 py-3">Nơi phát hiện</th>
              <th className="px-4 py-3">Điều khoản</th>
              <th className="px-4 py-3">Mô tả phát hiện</th>
              <th className="px-4 py-3 whitespace-nowrap">Thời hạn</th>
              <th className="px-4 py-3">Đánh giá viên</th>
              <th className="px-4 py-3">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((f) => {
              const st = FINDING_STATUS[f.status] ?? FINDING_STATUS.DRAFT;
              return (
                <tr key={f.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.code}</td>
                  <td className="px-4 py-3"><SeverityBadge value={f.severity} /></td>
                  <td className="px-4 py-3 text-slate-700">{f.auditee ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{f.rawArea ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {f.clauses.map((c) => `${c.standard} ${c.clause}`).join(', ') || '—'}
                  </td>
                  <td className="max-w-lg px-4 py-3">
                    <Link
                      href={`/quan-ly/dot/${id}/finding/${f.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {f.title ?? f.rawText.slice(0, 70) + '…'}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                      {f.statement ?? f.rawText}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <DueCell dueDate={f.dueDate} closed={f.status === 'CLOSED'} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{f.auditorName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`chip ring-transparent ${st.cls}`}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  {all.length === 0
                    ? 'Chưa có finding nào trong đợt này.'
                    : 'Không có finding nào khớp bộ lọc.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DueCell({ dueDate, closed }: { dueDate: Date | null; closed: boolean }) {
  if (!dueDate) return <span className="text-slate-400">—</span>;
  const { days, tone } = dueStatus(dueDate);
  const cls = closed
    ? 'text-slate-500'
    : tone === 'overdue'
      ? 'font-medium text-red-600'
      : tone === 'soon'
        ? 'font-medium text-amber-600'
        : 'text-slate-700';
  return (
    <div className={cls}>
      {formatDateOnly(dueDate)}
      {!closed && (
        <p className="text-xs font-normal">
          {days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Đến hạn hôm nay' : `Còn ${days} ngày`}
        </p>
      )}
    </div>
  );
}
