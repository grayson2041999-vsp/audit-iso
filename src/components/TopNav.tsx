'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Thanh điều hướng của trưởng đoàn.
 * Đánh giá viên không dùng thanh này — họ đi theo đường link đợt và có
 * thanh ngữ cảnh riêng (MemberBar).
 */
export function TopNav({ leaderName }: { leaderName: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  const links = leaderName ? [{ href: '/quan-ly', label: 'Đợt đánh giá' }] : [];

  async function logout() {
    await fetch('/api/auth/dang-xuat', { method: 'POST' });
    router.push('/dang-nhap');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href={leaderName ? '/quan-ly' : '/'} className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">
            ISO
          </span>
          <span className="hidden sm:inline">Đánh giá nội bộ</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {links.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-1.5 ${
                pathname.startsWith(n.href)
                  ? 'bg-slate-100 font-medium text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-sm">
          {leaderName ? (
            <>
              <span className="hidden text-slate-500 sm:inline">{leaderName}</span>
              <button onClick={logout} className="btn-ghost !py-1.5">Đăng xuất</button>
            </>
          ) : (
            <>
              <Link href="/dang-nhap" className="btn-ghost !py-1.5">Đăng nhập</Link>
              <Link href="/dang-ky" className="btn-primary !py-1.5">Đăng ký</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
