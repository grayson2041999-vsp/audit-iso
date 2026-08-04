import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { AuditList } from '@/components/AuditList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quản lý đợt đánh giá' };

export default async function Page() {
  const leader = await getLeader();
  if (!leader) redirect('/dang-nhap');

  let rows: (typeof audits.$inferSelect)[] = [];
  let dbError = false;
  try {
    rows = await db
      .select()
      .from(audits)
      .where(eq(audits.leaderId, leader.id))
      .orderBy(desc(audits.createdAt));
  } catch {
    dbError = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Đợt đánh giá</h1>
          <p className="mt-1 text-sm text-slate-500">
            Xin chào {leader.fullName} · {rows.length} đợt
          </p>
        </div>
        <Link href="/quan-ly/dot/moi" className="btn-primary">+ Tạo đợt đánh giá</Link>
      </div>

      {dbError && (
        <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Chưa truy vấn được cơ sở dữ liệu. Nếu vừa cập nhật, kiểm tra đã chạy
          <code> db/migration-003-leaders-audits.sql</code> trên Neon chưa.
        </div>
      )}

      {rows.length === 0 && !dbError ? (
        <div className="card grid place-items-center px-6 py-16 text-center">
          <p className="text-slate-600">Chưa có đợt đánh giá nào.</p>
          <p className="mt-1 text-sm text-slate-400">
            Tạo đợt đầu tiên để bắt đầu khai báo đơn vị và đánh giá viên.
          </p>
          <Link href="/quan-ly/dot/moi" className="btn-primary mt-4">+ Tạo đợt đánh giá</Link>
        </div>
      ) : (
        <AuditList
          rows={rows.map((a) => ({
            id: a.id,
            organization: a.organization,
            title: a.title,
            leadAuditor: a.leadAuditor,
            startDate: a.startDate ? a.startDate.toISOString() : null,
            endDate: a.endDate ? a.endDate.toISOString() : null,
            status: a.status,
            standards: a.standards,
          }))}
        />
      )}
    </div>
  );
}
