'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDateOnly } from '@/lib/utils';
import { STANDARD_SHORT, type StandardCode } from '@/lib/iso';

type Row = {
  id: string;
  organization: string;
  title: string;
  leadAuditor: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  standards: string[];
};

const AUDIT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Đang chuẩn bị', cls: 'text-slate-500' },
  IN_PROGRESS: { label: 'Đang thực hiện', cls: 'text-launch' },
  REPORTING: { label: 'Đang tổng hợp', cls: 'text-brand-700' },
  CLOSED: { label: 'Đã khoá', cls: 'text-slate-400' },
};

/**
 * Bỏ dấu và hạ chữ thường để so khớp.
 *
 * Gõ "danh gia qms" phải tìm ra "Đánh giá QMS" — không ai muốn phải bật bộ gõ
 * tiếng Việt chỉ để tìm một đợt trong danh sách của chính mình.
 */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/**
 * Danh sách đợt đánh giá kèm ô tìm kiếm.
 *
 * Lọc hoàn toàn ở trình duyệt: một trưởng đoàn có vài chục đợt là nhiều, gửi
 * yêu cầu lên máy chủ theo từng ký tự thì vừa chậm vừa vô ích.
 */
export function AuditList({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const needle = fold(q.trim());
    if (!needle) return rows;
    // Tìm cả tên tổ chức và trưởng đoàn: người dùng nhớ được gì thì gõ cái đó.
    return rows.filter((a) =>
      fold(`${a.title} ${a.organization} ${a.leadAuditor ?? ''}`).includes(needle),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.14 3.13a1 1 0 0 0 1.41-1.41l-3.13-3.14A5.5 5.5 0 0 0 9 3.5Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
            clipRule="evenodd"
          />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên đợt, tổ chức, trưởng đoàn…"
          className="input !pl-10"
        />
        {q && (
          <button
            onClick={() => setQ('')}
            aria-label="Xoá từ khoá"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="card px-6 py-12 text-center text-sm text-slate-500">
          Không có đợt nào khớp <strong>{q}</strong>.
        </p>
      ) : (
        <>
          {q && (
            <p className="text-xs text-slate-400">
              {shown.length} / {rows.length} đợt khớp từ khoá
            </p>
          )}

          <ul className="grid gap-5 md:grid-cols-2">
            {shown.map((a) => {
              const st = AUDIT_STATUS[a.status] ?? AUDIT_STATUS.PLANNED;
              return (
                <li key={a.id} className="card group transition-colors hover:border-hairline">
                  <Link href={`/quan-ly/dot/${a.id}`} className="block p-7">
                    {/* Launch Status Label: chữ trần 12px/600, không nền, không viền. */}
                    <p className={`text-xs font-semibold ${st.cls}`}>{st.label}</p>
                    <p className="mt-3 text-sm text-slate-500">{a.organization}</p>
                    <h2 className="mt-0.5 font-display text-xl font-semibold text-ink">{a.title}</h2>
                    <p className="mt-3 text-sm text-slate-500">
                      {formatDateOnly(a.startDate)} → {formatDateOnly(a.endDate)}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Trưởng đoàn: {a.leadAuditor ?? '—'}
                    </p>
                    <p className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
                      <span>
                      {a.standards.map((s) => STANDARD_SHORT[s as StandardCode] ?? s).join(' · ')}
                      </span>
                      <span className="text-sm text-brand-700 group-hover:underline">Mở ›</span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
