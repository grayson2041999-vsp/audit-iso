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

  return (
    <nav className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm ${
              active
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
