import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditSessions, auditUnits, findingImages, findings } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditSetup } from '@/components/AuditSetup';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import { AuditEdit } from '@/components/AuditEdit';
import { DeleteAuditBox } from '@/components/DeleteAuditBox';
import type { StandardCode } from '@/lib/iso';

export const dynamic = 'force-dynamic';

/**
 * Date → "YYYY-MM-DD" cho ô <input type="date">.
 * Dùng ISO chứ không dùng giờ máy: ngày đợt luôn được ghi vào lúc nửa đêm UTC,
 * đọc lại theo giờ máy sẽ lùi mất một ngày ở các múi giờ âm.
 */
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();

  const { audit } = owned;

  const [units, members, links, findingRows, sessionRows] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.createdAt)),
    db.select().from(auditMembers).where(eq(auditMembers.auditId, id)).orderBy(asc(auditMembers.createdAt)),
    db.select().from(assignments).where(eq(assignments.auditId, id)),
    db.select({ id: findings.id }).from(findings).where(eq(findings.auditId, id)),
    db.select({ day: auditSessions.day }).from(auditSessions).where(eq(auditSessions.auditId, id)),
  ]);

  // Số phiên trên từng ngày — form sửa ngày dùng để xem trước lịch sẽ dời đi đâu.
  const sessionsPerDay: Record<string, number> = {};
  for (const r of sessionRows) sessionsPerDay[r.day] = (sessionsPerDay[r.day] ?? 0) + 1;

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

      <AuditHeader audit={audit} />

      {audit.status !== 'CLOSED' && (
        <AuditEdit
          auditId={audit.id}
          sessionsPerDay={sessionsPerDay}
          initial={{
            organization: audit.organization,
            title: audit.title,
            scope: audit.scope ?? '',
            standards: audit.standards as StandardCode[],
            leadAuditor: audit.leadAuditor ?? '',
            startDate: ymd(audit.startDate),
            endDate: ymd(audit.endDate),
          }}
        />
      )}

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
