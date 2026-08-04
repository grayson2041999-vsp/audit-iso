import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditSessions, auditUnits } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import { AuditPlan } from '@/components/AuditPlan';
import { listDays, defaultObjectives, defaultCriteria, type PlanSession } from '@/lib/plan';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();
  const { audit } = owned;

  const [units, members, links, sessions] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.createdAt)),
    db
      .select()
      .from(auditMembers)
      .where(eq(auditMembers.auditId, id))
      .orderBy(asc(auditMembers.createdAt)),
    db.select().from(assignments).where(eq(assignments.auditId, id)),
    db
      .select()
      .from(auditSessions)
      .where(eq(auditSessions.auditId, id))
      .orderBy(asc(auditSessions.day), asc(auditSessions.startTime)),
  ]);

  const days = listDays(audit.startDate, audit.endDate);

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <AuditHeader audit={audit} />
      <AuditTabs auditId={id} />

      <AuditPlan
        auditId={id}
        days={days}
        locked={audit.status === 'CLOSED'}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        members={members.map((m) => ({ id: m.id, fullName: m.fullName }))}
        assignments={links.map((l) => `${l.memberId}:${l.unitId}`)}
        initialInfo={{
          // Lần đầu vào trang thì điền sẵn mẫu chuẩn thay vì để trống —
          // trưởng đoàn sửa nhanh hơn nhiều so với viết từ đầu.
          objectives: audit.objectives ?? defaultObjectives(),
          criteria: audit.criteria ?? defaultCriteria(audit.standards),
          location: audit.location ?? '',
          approverTitle: audit.approverTitle ?? '',
          approverName: audit.approverName ?? '',
          amStart: audit.amStart,
          amEnd: audit.amEnd,
          pmStart: audit.pmStart,
          pmEnd: audit.pmEnd,
          openingMinutes: audit.openingMinutes,
          closingMinutes: audit.closingMinutes,
        }}
        initialDayHours={audit.dayHours ?? []}
      initialSessions={sessions.map(
          (s): PlanSession => ({
            id: s.id,
            day: s.day,
            startTime: s.startTime,
            endTime: s.endTime,
            kind: s.kind,
            unitId: s.unitId,
            note: s.note,
          }),
        )}
      />
    </div>
  );
}
