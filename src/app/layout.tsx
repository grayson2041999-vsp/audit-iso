import type { Metadata } from 'next';
import { Be_Vietnam_Pro, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { TopNav } from '@/components/TopNav';
import { getLeader } from '@/lib/auth';

/**
 * Font được tải về máy chủ lúc build và phục vụ từ cùng tên miền — người dùng
 * mở trang không phải gọi sang Google, nên nhanh hơn và không lộ dữ liệu truy cập.
 *
 * Be Vietnam Pro do người Việt thiết kế riêng cho tiếng Việt: các tổ hợp dấu
 * chồng (ệ, ộ, ữ, ẳ…) được vẽ riêng thay vì ghép máy móc — thấy rõ nhất ở cỡ
 * chữ nhỏ trong bảng tổng hợp.
 */
const sans = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

/** Dùng cho mã truy cập 6 số và mã finding — số 0 có chấm giữa, không lẫn với chữ O. */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Đánh giá nội bộ ISO — Chuẩn hoá finding bằng AI',
  description:
    'Quản lý đợt đánh giá nội bộ và chuẩn hoá phát hiện theo ISO 9001 / 14001 / 45001',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const leader = await getLeader();

  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="min-h-screen">
          <TopNav leaderName={leader?.fullName ?? null} />
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
