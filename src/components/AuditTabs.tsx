'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Tab "Khắc phục" chỉ hiện sau khi đã phát hành báo cáo (`issued`). Trước đó
 * nó rỗng, hiện ra chỉ khiến người dùng bấm vào rồi thắc mắc.
 */
export function AuditTabs({ auditId, issued = false }: { auditId: string; issued?: boolean }) {
  const pathname = usePathname();

  const tabs = [
    { href: `/quan-ly/dot/${auditId}`, label: 'Chuẩn bị đợt', exact: true },
    { href: `/quan-ly/dot/${auditId}/chuong-trinh`, label: 'Chương trình đánh giá', exact: false },
    { href: `/quan-ly/dot/${auditId}/tong-hop`, label: 'Tổng hợp finding', exact: false },
    ...(issued
      ? [{ href: `/quan-ly/dot/${auditId}/khac-phuc`, label: 'Khắc phục', exact: false }]
      : []),
  ];

  // Điều khiển phân đoạn: rãnh Control Gray, mục đang chọn là viên trắng có viền 1px.
  return (
    <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-full bg-slate-200/70 p-1">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-white font-medium text-ink shadow-subtle'
                  : 'text-slate-600 hover:text-ink'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
