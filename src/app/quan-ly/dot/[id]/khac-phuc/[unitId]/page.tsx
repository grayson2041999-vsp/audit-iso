import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  auditUnits, correctiveEvents, correctiveItems, correctiveReports, findings,
} from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { getOwnedAudit } from '@/lib/audit-access';
import { CapaReview, type ReviewItem } from '@/components/CapaReview';
import { type CapaStatus } from '@/lib/capa';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id, unitId } = await params;

  if (!(await getLeader())) redirect('/dang-nhap');
  const owned = await getOwnedAudit(id);
  if (!owned) notFound();

  const [[unit], [report]] = await Promise.all([
    db.select().from(auditUnits).where(and(eq(auditUnits.id, unitId), eq(auditUnits.auditId, id))),
    db
      .select()
      .from(correctiveReports)
      .where(and(eq(correctiveReports.auditId, id), eq(correctiveReports.unitId, unitId))),
  ]);

  if (!unit) notFound();

  if (!report) {
    return (
      <div className="space-y-6">
        <Back id={id} />
        <div className="card p-6 text-sm text-slate-500">
          {unit.name} không có sự không phù hợp nào nên không phải nộp hồ sơ khắc phục.
        </div>
      </div>
    );
  }

  const [rows, events] = await Promise.all([
    db
      .select({ item: correctiveItems, finding: findings })
      .from(correctiveItems)
      .innerJoin(findings, eq(findings.id, correctiveItems.findingId))
      .where(and(eq(correctiveItems.reportId, report.id), eq(correctiveItems.isActive, true)))
      .orderBy(asc(findings.code)),
    db
      .select()
      .from(correctiveEvents)
      .where(eq(correctiveEvents.reportId, report.id))
      .orderBy(asc(correctiveEvents.createdAt)),
  ]);

  const items: ReviewItem[] = rows.map(({ item, finding }) => ({
    id: item.id,
    code: finding.code,
    severity: finding.severity,
    title: finding.title,
    statement: finding.statement,
    dueDate: finding.dueDate ? finding.dueDate.toISOString() : null,
    immediateAction: item.immediateAction,
    rootCause: item.rootCause,
    actionPlan: item.actionPlan,
    targetDate: item.targetDate ? item.targetDate.toISOString() : null,
    completionNote: item.completionNote,
    attachments: item.attachments,
    verdict: item.verdict,
    leaderNote: item.leaderNote,
  }));

  return (
    <div className="space-y-6">
      <Back id={id} />

      <div>
        <h1 className="text-xl font-semibold">{unit.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Hồ sơ khắc phục · lần nộp thứ {report.round}
          {report.responsibleName && (
            <>
              {' · '}
              {report.responsibleName}
              {report.responsibleTitle && ` (${report.responsibleTitle})`}
            </>
          )}
        </p>
      </div>

      <CapaReview
        auditId={id}
        unitId={unitId}
        status={report.status as CapaStatus}
        reviewNote={report.reviewNote}
        items={items}
      />

      {events.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold">Nhật ký</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 border-l-2 border-slate-200 pl-3">
                <span className="w-32 shrink-0 text-xs text-slate-400">
                  {formatDate(e.createdAt)}
                </span>
                <span>
                  <strong>{e.actor ?? '—'}</strong>{' '}
                  {describe(e.action, e.phase)}
                  {e.note && <span className="text-slate-500"> — {e.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function describe(action: string, phase: string) {
  const what = phase === 'plan' ? 'kế hoạch' : 'bằng chứng';
  if (action === 'submit') return `nộp ${what}`;
  if (action === 'approve') return phase === 'plan' ? 'duyệt kế hoạch' : 'xác nhận hiệu lực, đóng hồ sơ';
  return `trả lại ${what}`;
}

function Back({ id }: { id: string }) {
  return (
    <Link href={`/quan-ly/dot/${id}/khac-phuc`} className="text-sm text-slate-500 hover:underline">
      ← Danh sách đơn vị
    </Link>
  );
}
