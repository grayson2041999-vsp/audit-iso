import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditMembers, auditUnits, findings } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import { AuditLockButton } from '@/components/AuditLockButton';
import { FindingsTable, type FindingRow } from '@/components/FindingsTable';
import { IssueReportBox } from '@/components/IssueReportBox';
import { SEVERITY_LABELS } from '@/lib/iso';
import { SEVERITY_CARD } from '@/lib/utils';
import { needsCapa } from '@/lib/capa';

export const dynamic = 'force-dynamic';

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

  /**
   * Ba truy vấn, và finding lấy MỘT lần duy nhất cho cả thống kê lẫn bảng.
   * Việc lọc làm ở trình duyệt (xem FindingsTable) nên đổi bộ lọc không chạm
   * tới máy chủ — trước đây mỗi lần lọc là sáu truy vấn xuống Neon.
   */
  const [units, members, all] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
    db
      .select()
      .from(auditMembers)
      .where(eq(auditMembers.auditId, id))
      .orderBy(asc(auditMembers.fullName)),
    db.select().from(findings).where(eq(findings.auditId, id)).orderBy(desc(findings.createdAt)),
  ]);

  const countBy = (sev: string) => all.filter((f) => f.severity === sev).length;
  const drafts = all.filter((f) => f.status === 'DRAFT').length;

  const issued = Boolean(audit.issuedAt);

  /**
   * Đếm số sự không phù hợp của từng đơn vị — hộp phát hành cần con số này để
   * nói trước cho trưởng đoàn biết sẽ có mấy đơn vị phải nộp hồ sơ khắc phục.
   */
  const ncByUnit = new Map<string, number>();
  for (const f of all) {
    if (!f.unitId || !needsCapa(f.severity)) continue;
    ncByUnit.set(f.unitId, (ncByUnit.get(f.unitId) ?? 0) + 1);
  }

  // Link gửi cho đơn vị phải là URL tuyệt đối để dán được vào Zalo/email.
  const h = await headers();
  const baseUrl = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;

  const rows: FindingRow[] = all.map((f) => ({
    id: f.id,
    code: f.code,
    status: f.status,
    severity: f.severity,
    title: f.title,
    statement: f.statement,
    rawText: f.rawText,
    rawArea: f.rawArea,
    auditee: f.auditee,
    auditorName: f.auditorName,
    unitId: f.unitId,
    memberId: f.memberId,
    dueDate: f.dueDate ? f.dueDate.toISOString() : null,
    clauses: f.clauses,
  }));

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <AuditHeader audit={audit} />
        <AuditLockButton auditId={id} closed={audit.status === 'CLOSED'} issued={issued} />
      </div>

      <AuditTabs auditId={id} issued={issued} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Cùng màu với thẻ phân loại trong bảng bên dưới — nhìn ô là biết ngay loại nào. */}
        {(['MAJOR', 'MINOR', 'OBS', 'OFI'] as const).map((s) => (
          <div
            key={s}
            className={`rounded-xl border p-4 text-center ${SEVERITY_CARD[s]} ${
              countBy(s) === 0 ? 'opacity-60' : ''
            }`}
          >
            <p className="text-xs font-medium">{SEVERITY_LABELS[s]}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{countBy(s)}</p>
          </div>
        ))}
        {/* Không phải một mức phân loại nên giữ trung tính, đứng tách khỏi bốn ô kia. */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs font-medium text-slate-500">Chưa nộp</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              drafts > 0 ? 'text-amber-600' : 'text-slate-400'
            }`}
          >
            {drafts}
          </p>
        </div>
      </div>


      <FindingsTable
        auditId={id}
        rows={rows}
        units={units.map((u) => ({ id: u.id, label: u.name }))}
        members={members.map((m) => ({ id: m.id, label: m.fullName }))}
        initialFilters={{
          unit: sp.unit ?? '',
          member: sp.member ?? '',
          severity: sp.severity ?? '',
          status: sp.status ?? '',
        }}
      />

      <IssueReportBox
        auditId={id}
        closed={audit.status === 'CLOSED'}
        version={audit.reportVersion}
        issuedAt={audit.issuedAt ? audit.issuedAt.toISOString() : null}
        baseUrl={baseUrl}
        units={units.map((u) => ({
          id: u.id,
          name: u.name,
          code: u.accessCode,
          ncCount: ncByUnit.get(u.id) ?? 0,
        }))}
      />
    </div>
  );
}
