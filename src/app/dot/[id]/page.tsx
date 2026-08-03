import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditMembers, audits } from '@/lib/schema';
import { getMember } from '@/lib/member-auth';
import { MemberGate } from '@/components/MemberGate';
import { formatDateOnly } from '@/lib/utils';
import { STANDARD_SHORT, type StandardCode } from '@/lib/iso';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Đã vào rồi thì đi thẳng vào khu làm việc.
  if (await getMember(id)) redirect(`/dot/${id}/toi`);

  let audit: typeof audits.$inferSelect | undefined;
  let members: (typeof auditMembers.$inferSelect)[] = [];
  try {
    [audit] = await db.select().from(audits).where(eq(audits.id, id));
    if (audit) {
      members = await db
        .select()
        .from(auditMembers)
        .where(eq(auditMembers.auditId, id))
        .orderBy(asc(auditMembers.fullName));
    }
  } catch {
    /* rơi xuống notFound */
  }

  if (!audit) notFound();

  const notOpen = audit.status === 'PLANNED';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="text-center">
        <p className="font-mono text-xs text-slate-500">{audit.code}</p>
        <h1 className="mt-1 text-2xl font-semibold">{audit.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {formatDateOnly(audit.startDate)} → {formatDateOnly(audit.endDate)} · Trưởng đoàn:{' '}
          {audit.leadAuditor ?? '—'}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {audit.standards.map((s) => STANDARD_SHORT[s as StandardCode] ?? s).join(' · ')}
        </p>
      </div>

      {audit.status === 'CLOSED' && (
        <p className="rounded-lg bg-zinc-100 px-4 py-3 text-center text-sm text-zinc-700">
          Đợt đánh giá đã khoá. Bạn vẫn xem lại được finding của mình nhưng không sửa được.
        </p>
      )}

      {notOpen ? (
        <div className="card p-6 text-center text-sm text-slate-500">
          Đợt đánh giá chưa được mở. Trưởng đoàn còn đang phân công.
        </div>
      ) : (
        <MemberGate
          auditId={audit.id}
          members={members
            .filter((m) => m.accessCode)
            .map((m) => ({ id: m.id, fullName: m.fullName }))}
        />
      )}
    </div>
  );
}
