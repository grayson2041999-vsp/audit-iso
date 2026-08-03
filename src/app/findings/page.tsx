import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findings } from '@/lib/schema';
import { SeverityBadge, StatusBadge } from '@/components/Badge';
import { formatDate, formatDateOnly, dueStatus } from '@/lib/utils';

/** Hạn khắc phục kèm cảnh báo quá hạn / sắp đến hạn (bỏ qua nếu finding đã đóng). */
function DueDateCell({ dueDate, status }: { dueDate: Date | null; status: string }) {
  if (!dueDate) return <span className="text-slate-400">—</span>;

  const closed = status === 'CLOSED';
  const { days, tone } = dueStatus(dueDate);

  const toneCls = closed
    ? 'text-slate-500'
    : tone === 'overdue'
      ? 'font-medium text-red-600'
      : tone === 'soon'
        ? 'font-medium text-amber-600'
        : 'text-slate-700';

  return (
    <div className={toneCls}>
      {formatDateOnly(dueDate)}
      {!closed && (
        <p className="text-xs font-normal">
          {days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Đến hạn hôm nay' : `Còn ${days} ngày`}
        </p>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Danh sách finding' };

export default async function FindingsPage() {
  let rows: (typeof findings.$inferSelect)[] = [];
  let dbError = false;
  try {
    rows = await db.select().from(findings).orderBy(desc(findings.createdAt)).limit(200);
  } catch {
    dbError = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Danh sách finding</h1>
          <p className="mt-1 text-sm text-slate-500">{rows.length} bản ghi</p>
        </div>
        <Link href="/findings/new" className="btn-primary">+ Finding mới</Link>
      </div>

      {dbError && (
        <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Chưa kết nối được Neon. Kiểm tra <code>DATABASE_URL</code>.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">Phân loại phát hiện</th>
              <th className="px-4 py-3">Đơn vị được đánh giá</th>
              <th className="px-4 py-3">Nơi phát hiện</th>
              <th className="px-4 py-3">Điều khoản</th>
              <th className="px-4 py-3">Mô tả phát hiện</th>
              <th className="px-4 py-3 whitespace-nowrap">Thời hạn khắc phục</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 whitespace-nowrap">Ngày tạo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((f) => (
              <tr key={f.id} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3"><SeverityBadge value={f.severity} /></td>
                <td className="px-4 py-3 text-slate-700">{f.auditee ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{f.rawArea ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {f.clauses.map((c) => `${c.standard} ${c.clause}`).join(', ') || '—'}
                </td>
                <td className="max-w-lg px-4 py-3">
                  <Link href={`/findings/${f.id}`} className="font-medium text-brand-700 hover:underline">
                    {f.title ?? (f.rawText.slice(0, 70) + '…')}
                  </Link>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                    {f.statement ?? f.rawText}
                  </p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <DueDateCell dueDate={f.dueDate} status={f.status} />
                </td>
                <td className="px-4 py-3"><StatusBadge value={f.status} /></td>
                <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                  {formatDate(f.createdAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !dbError && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">Chưa có dữ liệu.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
