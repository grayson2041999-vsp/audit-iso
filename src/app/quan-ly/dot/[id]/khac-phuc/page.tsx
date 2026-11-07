import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits, capaActions, findings } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { AuditTabs } from '@/components/AuditTabs';
import { AuditHeader } from '@/components/AuditHeader';
import { CapaTracker, type CapaFinding, type CapaRow } from '@/components/CapaTracker';
import { canHaveCapa, todayVN } from '@/lib/capa';

export const dynamic = 'force-dynamic';

const dayVN = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d) : null;

/**
 * Theo dõi khắc phục — sổ theo dõi do trưởng đoàn tự nhập. Đoàn và đơn vị trao
 * đổi ở ngoài app; trang này chỉ ghi lại việc gì, hạn nào, tới đâu.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();
  const { audit } = owned;

  const [units, all, actions] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
    db.select().from(findings).where(eq(findings.auditId, id)).orderBy(asc(findings.code)),
    db.select().from(capaActions).where(eq(capaActions.auditId, id)).orderBy(asc(capaActions.createdAt)),
  ]);

  const unitName = new Map(units.map((u) => [u.id, u.name]));

  const capaFindings: CapaFinding[] = all
    .filter((f) => canHaveCapa(f.severity))
    .map((f) => ({
      id: f.id,
      code: f.code,
      severity: f.severity!,
      title: f.title || f.rawText.slice(0, 160),
      statement: f.statement,
      unitId: f.unitId,
      unitName: (f.unitId && unitName.get(f.unitId)) || f.auditee || 'Chưa gán đơn vị',
      dueDate: dayVN(f.dueDate),
      clauses: f.clauses,
    }));

  const rows: CapaRow[] = actions.map((a) => ({
    id: a.id,
    findingId: a.findingId,
    content: a.content,
    owner: a.owner,
    dueDate: a.dueDate,
    status: a.status,
    completedDate: a.completedDate,
    note: a.note,
    updatedAt: a.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>

      <AuditHeader audit={audit} />
      <AuditTabs auditId={id} />

      <CapaTracker
        auditId={id}
        today={todayVN()}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        findings={capaFindings}
        initialRows={rows}
      />
    </div>
  );
}
