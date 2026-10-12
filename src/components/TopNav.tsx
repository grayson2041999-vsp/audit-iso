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
    // Global nav theo DESIGN.md: cao 44px, nền trắng mờ kính, viền 1px Control Gray.
    <header className="sticky top-0 z-30 border-b border-control bg-white/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-11 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link
          href={leaderName ? '/quan-ly' : '/'}
          className="flex items-center gap-2 text-ink"
        >
          <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-ink text-[9px] font-semibold tracking-tight text-white">
            ISO
          </span>
          <span className="hidden font-display text-[15px] font-semibold tracking-tight sm:inline">
            Đánh giá nội bộ
          </span>
        </Link>

        <nav className="flex items-center gap-5 text-xs">
          {links.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={
                pathname.startsWith(n.href)
                  ? 'text-ink'
                  : 'text-ink/60 transition-colors hover:text-ink'
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {leaderName ? (
            <>
              <span className="hidden text-ink/60 sm:inline">{leaderName}</span>
              <button onClick={logout} className="btn-ghost btn-sm">Đăng xuất</button>
            </>
          ) : (
            <>
              <Link href="/dang-nhap" className="btn-ghost btn-sm">Đăng nhập</Link>
              <Link href="/dang-ky" className="btn-primary btn-sm">Đăng ký</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
