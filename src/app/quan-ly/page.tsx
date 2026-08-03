import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits } from '@/lib/schema';
import { getLeader } from '@/lib/auth';
import { formatDateOnly } from '@/lib/utils';
import { STANDARD_SHORT, type StandardCode } from '@/lib/iso';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quản lý đợt đánh giá' };

const AUDIT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Đang chuẩn bị', cls: 'bg-slate-100 text-slate-700' },
  IN_PROGRESS: { label: 'Đang thực hiện', cls: 'bg-emerald-100 text-emerald-800' },
  REPORTING: { label: 'Đang tổng hợp', cls: 'bg-blue-100 text-blue-800' },
  CLOSED: { label: 'Đã khoá', cls: 'bg-zinc-200 text-zinc-700' },
};

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
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map((a) => {
            const st = AUDIT_STATUS[a.status] ?? AUDIT_STATUS.PLANNED;
            return (
              <li key={a.id} className="card p-5 transition hover:border-brand-300 hover:shadow">
                <Link href={`/quan-ly/dot/${a.id}`} className="block">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{a.code}</span>
                  <span className={`chip ring-transparent ${st.cls}`}>{st.label}</span>
                </div>
                <h2 className="font-semibold">{a.title}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDateOnly(a.startDate)} → {formatDateOnly(a.endDate)}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  Trưởng đoàn: {a.leadAuditor ?? '—'}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {a.standards
                    .map((s) => STANDARD_SHORT[s as StandardCode] ?? s)
                    .join(' · ')}
                </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
