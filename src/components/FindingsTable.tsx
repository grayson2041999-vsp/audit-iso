'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { SeverityBadge } from './Badge';
import { SEVERITY_LABELS } from '@/lib/iso';
import { formatDateOnly, dueStatus } from '@/lib/utils';

export type FindingRow = {
  id: string;
  code: string | null;
  status: string;
  severity: string | null;
  title: string | null;
  statement: string | null;
  rawText: string;
  rawArea: string | null;
  auditee: string | null;
  auditorName: string | null;
  unitId: string | null;
  memberId: string | null;
  dueDate: string | null;
  clauses: { standard: string; clause: string; clauseTitle: string }[];
};

type Option = { id: string; label: string };

const FINDING_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Bản nháp', cls: 'bg-amber-100 text-amber-800' },
  AI_DRAFTED: { label: 'Bản nháp', cls: 'bg-amber-100 text-amber-800' },
  SUBMITTED: { label: 'Đã nộp', cls: 'bg-emerald-100 text-emerald-800' },
  REVIEWED: { label: 'Đã rà soát', cls: 'bg-blue-100 text-blue-800' },
  ISSUED: { label: 'Đã phát hành', cls: 'bg-blue-100 text-blue-800' },
  CLOSED: { label: 'Đã đóng', cls: 'bg-zinc-200 text-zinc-700' },
};

const STATUS_OPTIONS: Option[] = [
  { id: 'DRAFT', label: 'Bản nháp (chưa nộp)' },
  { id: 'SUBMITTED', label: 'Đã nộp' },
  { id: 'REVIEWED', label: 'Đã rà soát' },
  { id: 'CLOSED', label: 'Đã đóng' },
];

type Filters = { unit: string; member: string; severity: string; status: string };

/**
 * Bảng tổng hợp + bộ lọc, lọc HOÀN TOÀN trong trình duyệt.
 *
 * Trước đây bộ lọc ghi vào URL và mỗi lần đổi là dựng lại cả trang từ máy chủ —
 * sáu truy vấn xuống Neon, và Next.js không hiện khung xương khi chỉ đổi tham số
 * nên màn hình đứng im như treo.
 *
 * Toàn bộ finding của đợt vốn ĐÃ được tải về để tính bốn ô thống kê, nên lọc tại
 * chỗ không tốn thêm byte nào — thậm chí bỏ được hẳn một truy vấn so với trước.
 *
 * URL vẫn được cập nhật bằng `history.replaceState` để giữ được việc gửi link đã
 * lọc và để nút Xuất Excel mang đúng bộ lọc, nhưng KHÔNG kích hoạt điều hướng.
 */
export function FindingsTable({
  auditId, rows, units, members, initialFilters,
}: {
  auditId: string;
  rows: FindingRow[];
  units: Option[];
  members: Option[];
  initialFilters: Filters;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [filters]);

  // Ghi bộ lọc vào thanh địa chỉ mà không điều hướng — không chạm tới máy chủ.
  useEffect(() => {
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [query]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (f) =>
          (!filters.unit || f.unitId === filters.unit) &&
          (!filters.member || f.memberId === filters.member) &&
          (!filters.severity || f.severity === filters.severity) &&
          (!filters.status || f.status === filters.status),
      ),
    [rows, filters],
  );

  const hasFilter = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Đơn vị"
          value={filters.unit}
          onChange={(v) => setFilters((f) => ({ ...f, unit: v }))}
          options={units}
        />
        <Select
          label="Đánh giá viên"
          value={filters.member}
          onChange={(v) => setFilters((f) => ({ ...f, member: v }))}
          options={members}
        />
        <Select
          label="Mức độ"
          value={filters.severity}
          onChange={(v) => setFilters((f) => ({ ...f, severity: v }))}
          options={Object.entries(SEVERITY_LABELS).map(([id, label]) => ({ id, label }))}
        />
        <Select
          label="Trạng thái"
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={STATUS_OPTIONS}
        />

        {hasFilter && (
          <button
            onClick={() => setFilters({ unit: '', member: '', severity: '', status: '' })}
            className="btn-ghost"
          >
            Bỏ lọc
          </button>
        )}

        <a
          href={`/api/audits/${auditId}/xuat-excel${query ? `?${query}` : ''}`}
          className="btn-ghost ml-auto"
        >
          Xuất Excel{hasFilter ? ' (theo bộ lọc)' : ''}
        </a>
      </div>

      {hasFilter && (
        <p className="text-sm text-slate-500">
          Hiện {filtered.length} / {rows.length} finding
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1150px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Mã</th>
              <th className="whitespace-nowrap px-4 py-3">Phân loại</th>
              <th className="px-4 py-3">Đơn vị được đánh giá</th>
              <th className="px-4 py-3">Nơi phát hiện</th>
              <th className="px-4 py-3">Điều khoản</th>
              <th className="px-4 py-3">Mô tả phát hiện</th>
              <th className="whitespace-nowrap px-4 py-3">Thời hạn</th>
              <th className="px-4 py-3">Đánh giá viên</th>
              <th className="px-4 py-3">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((f) => {
              const st = FINDING_STATUS[f.status] ?? FINDING_STATUS.DRAFT;
              return (
                <tr key={f.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.code}</td>
                  <td className="px-4 py-3"><SeverityBadge value={f.severity} /></td>
                  <td className="px-4 py-3 text-slate-700">{f.auditee ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{f.rawArea ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {f.clauses.map((c) => `${c.standard} ${c.clause}`).join(', ') || '—'}
                  </td>
                  <td className="max-w-lg px-4 py-3">
                    <Link
                      href={`/quan-ly/dot/${auditId}/finding/${f.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {f.title ?? f.rawText.slice(0, 70) + '…'}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                      {f.statement ?? f.rawText}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <DueCell dueDate={f.dueDate} closed={f.status === 'CLOSED'} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{f.auditorName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`chip ring-transparent ${st.cls}`}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  {rows.length === 0
                    ? 'Chưa có finding nào trong đợt này.'
                    : 'Không có finding nào khớp bộ lọc.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) {
  return (
    <div>
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function DueCell({ dueDate, closed }: { dueDate: string | null; closed: boolean }) {
  if (!dueDate) return <span className="text-slate-400">—</span>;
  const { days, tone } = dueStatus(dueDate);
  const cls = closed
    ? 'text-slate-500'
    : tone === 'overdue'
      ? 'font-medium text-red-600'
      : tone === 'soon'
        ? 'font-medium text-amber-600'
        : 'text-slate-700';
  return (
    <div className={cls}>
      {formatDateOnly(dueDate)}
      {!closed && (
        <p className="text-xs font-normal">
          {days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Đến hạn hôm nay' : `Còn ${days} ngày`}
        </p>
      )}
    </div>
  );
}
