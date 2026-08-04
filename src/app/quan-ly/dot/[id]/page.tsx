import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditUnits, findingImages, findings } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit, AUDIT_STATUS_LABELS, AUDIT_STATUS_STYLE } from '@/lib/audit-access';
import { AuditSetup } from '@/components/AuditSetup';
import { AuditTabs } from '@/components/AuditTabs';
import { DeleteAuditBox } from '@/components/DeleteAuditBox';
import { formatDateOnly } from '@/lib/utils';
import { STANDARD_SHORT, type StandardCode } from '@/lib/iso';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();

  const { audit } = owned;

  const [units, members, links, findingRows] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.createdAt)),
    db.select().from(auditMembers).where(eq(auditMembers.auditId, id)).orderBy(asc(auditMembers.createdAt)),
    db.select().from(assignments).where(eq(assignments.auditId, id)),
    db.select({ id: findings.id }).from(findings).where(eq(findings.auditId, id)),
  ]);

  // Đếm ảnh để cảnh báo trước khi xoá — ảnh nằm trên R2, mất là mất hẳn.
  const imageCount = findingRows.length
    ? Number(
        (
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(findingImages)
            .where(inArray(findingImages.findingId, findingRows.map((f) => f.id)))
        )[0]?.n ?? 0,
      )
    : 0;

  // Dựng URL công khai của đợt từ chính request hiện tại.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const publicUrl = `${proto}://${host}/dot/${audit.id}`;

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`chip ring-transparent ${AUDIT_STATUS_STYLE[audit.status] ?? ''}`}
          >
            {AUDIT_STATUS_LABELS[audit.status] ?? audit.status}
          </span>
        </div>
        <p className="text-sm font-medium text-slate-500">{audit.organization}</p>
        <h1 className="text-2xl font-semibold">{audit.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {formatDateOnly(audit.startDate)} → {formatDateOnly(audit.endDate)} · Trưởng đoàn:{' '}
          {audit.leadAuditor ?? '—'} ·{' '}
          {audit.standards.map((s) => STANDARD_SHORT[s as StandardCode] ?? s).join(' · ')}
        </p>
        {audit.scope && <p className="mt-2 max-w-3xl text-sm text-slate-600">{audit.scope}</p>}
      </div>

      <AuditTabs auditId={audit.id} />

      <AuditSetup
        auditId={audit.id}
        status={audit.status}
        units={units}
        members={members}
        links={links.map((l) => `${l.memberId}:${l.unitId}`)}
        publicUrl={publicUrl}
        leaderName={owned.leader.fullName}
      />

      <DeleteAuditBox
        auditId={audit.id}
        auditTitle={audit.title}
        counts={{
          units: units.length,
          members: members.length,
          findings: findingRows.length,
          images: imageCount,
        }}
      />
    </div>
  );
}
