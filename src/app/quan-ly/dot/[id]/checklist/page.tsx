import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditSessions, auditUnits } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import { LeaderChecklist } from '@/components/LeaderChecklist';
import { toMinutes } from '@/lib/plan';

export const dynamic = 'force-dynamic';

/**
 * Checklist đánh giá — trưởng đoàn soạn checklist cho bất kỳ đơn vị nào của
 * đợt, kể cả trước khi mở đợt. Không lưu vào hệ thống: soạn, sửa, tải Word.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();
  const { audit } = owned;

  const [units, people, sessions] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.createdAt)),
    db
      .select({ unitId: assignments.unitId, name: auditMembers.fullName })
      .from(assignments)
      .innerJoin(auditMembers, eq(assignments.memberId, auditMembers.id))
      .where(eq(assignments.auditId, id))
      .orderBy(asc(auditMembers.createdAt)),
    db
      .select({ unitId: auditSessions.unitId, startTime: auditSessions.startTime, endTime: auditSessions.endTime })
      .from(auditSessions)
      .where(and(eq(auditSessions.auditId, id), eq(auditSessions.kind, 'UNIT'))),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <AuditHeader audit={audit} />
      <AuditTabs auditId={id} />

      <LeaderChecklist
        auditId={id}
        standards={audit.standards}
        locked={audit.status === 'CLOSED'}
        units={units.map((u) => ({
          id: u.id,
          name: u.name,
          auditors: people.filter((p) => p.unitId === u.id).map((p) => p.name),
          // Tổng thời lượng các phiên của đơn vị trong lịch — cùng cách tính với lúc soạn.
          minutes:
            sessions
              .filter((s) => s.unitId === u.id)
              .reduce((n, s) => n + Math.max(0, toMinutes(s.endTime) - toMinutes(s.startTime)), 0) || null,
        }))}
      />
    </div>
  );
}
