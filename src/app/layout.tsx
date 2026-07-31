import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chuẩn hoá Finding ISO — Đánh giá nội bộ',
  description: 'Công cụ AI hỗ trợ auditor nội bộ chuẩn hoá phát hiện theo ISO 9001 / 14001 / 45001',
};

const nav = [
  { href: '/', label: 'Tổng quan' },
  { href: '/findings', label: 'Danh sách finding' },
  { href: '/findings/new', label: 'Ghi nhận mới' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <div className="min-h-screen">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">
                  ISO
                </span>
                <span className="hidden sm:inline">Chuẩn hoá Finding</span>
              </Link>
              <nav className="flex items-center gap-1 text-sm">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto">
                <Link href="/findings/new" className="btn-primary !py-1.5">
                  + Finding mới
                </Link>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
