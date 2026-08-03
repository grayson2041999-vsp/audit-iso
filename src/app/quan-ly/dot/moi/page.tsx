import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuditForm } from '@/components/AuditForm';
import { getLeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tạo đợt đánh giá' };

export default async function Page() {
  const leader = await getLeader();
  if (!leader) redirect('/dang-nhap');

  return (
    <div className="space-y-6">
      <Link href="/quan-ly" className="text-sm text-slate-500 hover:underline">
        ← Danh sách đợt đánh giá
      </Link>
      <h1 className="text-2xl font-semibold">Tạo đợt đánh giá mới</h1>
      <AuditForm leaderName={leader.fullName} />
    </div>
  );
}
