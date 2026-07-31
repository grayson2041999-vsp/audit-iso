import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { findings } from '@/lib/schema';
import { SeverityBadge, StatusBadge } from '@/components/Badge';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function loadData() {
  try {
    const recent = await db.select().from(findings).orderBy(desc(findings.createdAt)).limit(8);
    const counts = await db
      .select({ severity: findings.severity, n: sql<number>`count(*)::int` })
      .from(findings)
      .groupBy(findings.severity);
    return { recent, counts, ok: true as const };
  } catch {
    return { recent: [], counts: [], ok: false as const };
  }
}

const CARDS = [
  { key: 'MAJOR', label: 'Không phù hợp nặng', cls: 'text-red-600' },
  { key: 'MINOR', label: 'Không phù hợp nhẹ', cls: 'text-amber-600' },
  { key: 'OBS', label: 'Quan sát', cls: 'text-sky-600' },
  { key: 'OFI', label: 'Cơ hội cải tiến', cls: 'text-emerald-600' },
];

export default async function HomePage() {
  const { recent, counts, ok } = await loadData();
  const get = (k: string) => counts.find((c) => c.severity === k)?.n ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Tổng quan</h1>
        <p className="mt-1 text-sm text-slate-500">
          Chuẩn hoá phát hiện đánh giá nội bộ theo ISO 9001:2015 / ISO 14001:2015 / ISO 45001:2018.
        </p>
      </div>

      {!ok && (
        <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Chưa kết nối được cơ sở dữ liệu Neon. Kiểm tra biến <code>DATABASE_URL</code> trong file
          <code> .env.local</code> và chạy <code>db/init.sql</code>.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.key} className="card p-5">
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className={`mt-2 text-3xl font-semibold ${c.cls}`}>{get(c.key)}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="font-semibold">Finding gần đây</h2>
          <Link href="/findings" className="text-sm text-brand-600 hover:underline">Xem tất cả →</Link>
        </div>

        {recent.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            Chưa có finding nào.{' '}
            <Link href="/findings/new" className="text-brand-600 hover:underline">Tạo finding đầu tiên</Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((f) => (
              <li key={f.id}>
                <Link href={`/findings/${f.id}`} className="flex items-start gap-4 px-5 py-3.5 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.title ?? f.rawText.slice(0, 90)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {f.rawArea ?? '—'} · {formatDate(f.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <SeverityBadge value={f.severity} />
                    <StatusBadge value={f.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
