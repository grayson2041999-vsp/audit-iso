import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits, audits } from '@/lib/schema';
import { getUnitSession } from '@/lib/unit-auth';
import { UnitGate } from '@/components/UnitGate';
import { formatDateOnly } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Trang đơn vị mở khi nhận được link.
 *
 * Trước khi nhập mã, trang này CHỈ hiện tên đợt và danh sách tên đơn vị —
 * không một dòng nội dung báo cáo nào. Link bị forward nhầm vào nhóm chat thì
 * người lạ cũng chỉ thấy đúng chừng đó.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (await getUnitSession(id)) redirect(`/bao-cao/${id}/don-vi`);

  let audit: typeof audits.$inferSelect | undefined;
  let units: (typeof auditUnits.$inferSelect)[] = [];
  try {
    [audit] = await db.select().from(audits).where(eq(audits.id, id));
    if (audit) {
      units = await db
        .select()
        .from(auditUnits)
        .where(eq(auditUnits.auditId, id))
        .orderBy(asc(auditUnits.name));
    }
  } catch {
    /* rơi xuống notFound */
  }

  if (!audit) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">{audit.organization}</p>
        <h1 className="mt-1 text-xl font-semibold">Báo cáo đánh giá nội bộ</h1>
        <p className="mt-1 text-sm text-slate-500">
          {audit.title}
          {audit.startDate && ` · ${formatDateOnly(audit.startDate)}`}
        </p>
      </div>

      {audit.issuedAt ? (
        <UnitGate
          auditId={audit.id}
          units={units.filter((u) => u.accessCode).map((u) => ({ id: u.id, name: u.name }))}
        />
      ) : (
        <div className="card p-6 text-center text-sm text-slate-500">
          Báo cáo của đợt này chưa được phát hành.
        </div>
      )}
    </div>
  );
}
