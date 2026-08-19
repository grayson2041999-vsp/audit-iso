import { redirect } from 'next/navigation';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { correctiveItems, correctiveReports, reportReleases } from '@/lib/schema';
import { getUnitSession } from '@/lib/unit-auth';
import { UnitPortal, type PortalItem } from '@/components/UnitPortal';
import { type CapaStatus } from '@/lib/capa';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getUnitSession(id);
  if (!session) redirect(`/bao-cao/${id}`);
  const { unit, audit } = session;

  /**
   * ĐỌC ẢNH CHỤP, KHÔNG ĐỌC BẢNG `findings`.
   *
   * Đây là chỗ nguyên tắc của toàn bộ tính năng được thực thi: trưởng đoàn có
   * mở đợt ra sửa gì thì đơn vị vẫn thấy đúng bản đã phát hành, cho tới khi
   * bản mới được phát hành.
   */
  const [release] = await db
    .select()
    .from(reportReleases)
    .where(eq(reportReleases.auditId, id))
    .orderBy(desc(reportReleases.version))
    .limit(1);

  if (!release) redirect(`/bao-cao/${id}`);

  const [report] = await db
    .select()
    .from(correctiveReports)
    .where(and(eq(correctiveReports.auditId, id), eq(correctiveReports.unitId, unit.id)));

  let items: PortalItem[] = [];
  if (report) {
    const rows = await db
      .select()
      .from(correctiveItems)
      .where(and(eq(correctiveItems.reportId, report.id), eq(correctiveItems.isActive, true)))
      .orderBy(asc(correctiveItems.createdAt));

    const byId = new Map(release.snapshot.map((f) => [f.id, f]));

    items = rows.map((it) => {
      const f = byId.get(it.findingId);
      return {
        id: it.id,
        code: f?.code ?? null,
        severity: f?.severity ?? null,
        title: f?.title ?? null,
        statement: f?.statement ?? null,
        clauses: f?.clauses ?? [],
        dueDate: f?.dueDate ?? null,
        immediateAction: it.immediateAction ?? '',
        rootCause: it.rootCause ?? '',
        actionPlan: it.actionPlan ?? '',
        targetDate: it.targetDate ? it.targetDate.toISOString().slice(0, 10) : '',
        completionNote: it.completionNote ?? '',
        verdict: it.verdict,
        leaderNote: it.leaderNote,
      };
    });
  }

  return (
    <UnitPortal
      auditId={id}
      organization={audit.organization}
      auditTitle={audit.title}
      unitId={unit.id}
      unitName={unit.name}
      version={release.version}
      releaseReason={release.reason}
      releasedAt={release.createdAt.toISOString()}
      findings={release.snapshot}
      hasReport={Boolean(report)}
      status={(report?.status ?? 'PLAN_DRAFT') as CapaStatus}
      round={report?.round ?? 1}
      reviewNote={report?.reviewNote ?? null}
      responsibleName={report?.responsibleName ?? ''}
      responsibleTitle={report?.responsibleTitle ?? ''}
      items={items}
    />
  );
}
