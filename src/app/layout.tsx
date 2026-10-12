import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { TopNav } from '@/components/TopNav';
import { getLeader } from '@/lib/auth';

/**
 * Font được tải về máy chủ lúc build và phục vụ từ cùng tên miền — người dùng
 * mở trang không phải gọi sang Google, nên nhanh hơn và không lộ dữ liệu truy cập.
 *
 * Theo DESIGN.md: chữ chính là SF Pro (có sẵn trên Mac/iPhone, xem fontFamily
 * trong tailwind.config.ts). Inter là bản thay thế cho Windows/Android — có bộ
 * dấu tiếng Việt đầy đủ và cùng tinh thần chữ gọn, tracking âm.
 */
const sans = Inter({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600'],
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
  applicationName: 'Đánh giá ISO',
  // Tên hiện dưới biểu tượng khi lưu ra màn hình chính iPhone (tiêu đề trang thì quá dài).
  // Biểu tượng: src/app/icon.svg, favicon.ico, apple-icon.png và manifest.ts — Next.js tự gắn.
  appleWebApp: { title: 'Đánh giá ISO' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const leader = await getLeader();

  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="min-h-screen">
          <TopNav leaderName={leader?.fullName ?? null} />
          <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">{children}</main>
        </div>
      </body>
    </html>
  );
}
