import type { Metadata } from 'next';
import './globals.css';
import { TopNav } from '@/components/TopNav';
import { getLeader } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Đánh giá nội bộ ISO — Chuẩn hoá finding bằng AI',
  description:
    'Quản lý đợt đánh giá nội bộ và chuẩn hoá phát hiện theo ISO 9001 / 14001 / 45001',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const leader = await getLeader();

  return (
    <html lang="vi">
      <body>
        <div className="min-h-screen">
          <TopNav leaderName={leader?.fullName ?? null} />
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
