import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditUnits } from '@/lib/schema';
import { getMember, memberOwnsUnit } from '@/lib/member-auth';
import { MemberBar } from '@/components/MemberBar';
import { FindingEntry } from '@/components/FindingEntry';
import type { StandardCode } from '@/lib/iso';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id, unitId } = await params;

  const session = await getMember(id);
  if (!session) redirect(`/dot/${id}`);
  const { member, audit } = session;

  if (audit.status === 'CLOSED') redirect(`/dot/${id}/don-vi/${unitId}`);
  if (!(await memberOwnsUnit(id, member.id, unitId))) notFound();

  const [unit] = await db.select().from(auditUnits).where(eq(auditUnits.id, unitId));
  if (!unit) notFound();

  return (
    <div className="space-y-6">
      <MemberBar auditId={id} auditTitle={audit.title} memberName={member.fullName} />

      <Link
        href={`/dot/${id}/don-vi/${unitId}`}
        className="block text-sm text-slate-500 hover:underline"
      >
        ← {unit.name}
      </Link>

      <h1 className="text-2xl font-semibold">Ghi nhận & chuẩn hoá finding</h1>

      <FindingEntry
        auditId={id}
        unitId={unitId}
        unitName={unit.name}
        memberName={member.fullName}
        defaultStandards={audit.standards as StandardCode[]}
      />
    </div>
  );
}
