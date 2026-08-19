'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { SeverityBadge } from './Badge';
import { SEVERITY_LABELS } from '@/lib/iso';
import { ExcelIcon } from './FileIcons';
import { formatDateOnly, dueStatus, abbreviateName, buildShortNames } from '@/lib/utils';

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

  /**
   * Tên viết tắt cho cột Đánh giá viên. Tính trên cả danh sách để phát hiện
   * trùng dạng viết tắt; finding của người đã bị xoá khỏi đợt thì dùng tên
   * được chụp lại trong chính finding, viết tắt riêng lẻ.
   */
  const shortByMember = useMemo(() => {
    const shorts = buildShortNames(members.map((m) => m.label));
    return new Map(members.map((m, i) => [m.id, shorts[i]]));
  }, [members]);

  const auditorLabel = (f: FindingRow) =>
    (f.memberId && shortByMember.get(f.memberId)) ||
    (f.auditorName ? abbreviateName(f.auditorName) : '—');

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
          className="btn-ghost ml-auto inline-flex items-center gap-2"
        >
          <ExcelIcon />
          Xuất Excel{hasFilter ? ' (theo bộ lọc)' : ''}
        </a>
      </div>

      {hasFilter && (
        <p className="text-sm text-slate-500">
          Hiện {filtered.length} / {rows.length} finding
        </p>
      )}

      {/**
       * BỐN CỘT, KHÔNG PHẢI CHÍN.
       *
       * Bản trước có chín cột, mà bảy trong số đó chỉ chứa vài chữ — chúng chia
       * nhau gần hết bề ngang và ép cột Mô tả xuống còn một dải hẹp, khiến mỗi
       * hàng cao mười mấy dòng. Gộp những mẩu ngắn lại theo NHÓM Ý NGHĨA:
       *
       *   1. Định danh & phân loại  — mã, mức độ, trạng thái
       *   2. Ai & ở đâu             — đơn vị, đánh giá viên, nơi phát hiện
       *   3. Nội dung               — tiêu đề, phát biểu, điều khoản viện dẫn
       *   4. Thời hạn               — đứng riêng vì đây là cột người ta lướt mắt
       *                               tìm màu đỏ/vàng, gộp vào là mất tác dụng
       *
       * Điều khoản chuyển xuống dưới phát biểu và gom theo tiêu chuẩn
       * ("ISO 45001:2018 — 6.1.1, 6.1.2.1, 6.1.2.2") thay vì mỗi mã một dòng.
       */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm [&_td]:border [&_td]:border-slate-200 [&_th]:border [&_th]:border-slate-200">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-32 px-3 py-3">Mã · Phân loại</th>
              <th className="w-48 px-3 py-3">Đơn vị · Đánh giá viên</th>
              <th className="px-3 py-3">Nội dung phát hiện</th>
              <th className="w-32 px-3 py-3">Thời hạn</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const st = FINDING_STATUS[f.status] ?? FINDING_STATUS.DRAFT;
              return (
                <tr key={f.id} className="align-top hover:bg-slate-50">
                  {/* 1. Định danh & phân loại — ba mẩu ngắn, xếp chồng thay vì ba cột */}
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs text-slate-600">{f.code}</span>
                    <div className="mt-1.5 flex flex-col items-start gap-1">
                      <SeverityBadge value={f.severity} short />
                      <span className={`chip whitespace-nowrap ring-transparent ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                  </td>

                  {/* 2. Ai & ở đâu. "Nơi phát hiện" thường để trống nên chỉ hiện khi có. */}
                  <td className="px-3 py-3">
                    <p className="text-slate-800">{f.auditee ?? '—'}</p>
                    <p className="mt-0.5 text-xs text-slate-500" title={f.auditorName ?? undefined}>
                      {auditorLabel(f)}
                    </p>
                    {f.rawArea && (
                      <p className="mt-1.5 text-xs text-slate-500">Nơi phát hiện: {f.rawArea}</p>
                    )}
                  </td>

                  {/**
                   * 3. Nội dung — cột duy nhất được co giãn, nên phát biểu hiện ĐẦY ĐỦ
                   * mà hàng vẫn không cao quá.
                   *
                   * `whitespace-pre-wrap` giữ xuống dòng auditor đã gõ; `align-top` ở
                   * hàng giữ các cột ngắn dính mép trên thay vì trôi xuống giữa ô.
                   */}
                  <td className="px-3 py-3">
                    <Link
                      href={`/quan-ly/dot/${auditId}/finding/${f.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {f.title ?? f.rawText.slice(0, 70) + '…'}
                    </Link>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {f.statement ?? f.rawText}
                    </p>
                    {f.clauses.length > 0 && (
                      <p className="mt-2 text-xs text-slate-500">
                        {clauseSummary(f.clauses).map((line) => (
                          <span key={line} className="mr-3 inline-block whitespace-nowrap">
                            {line}
                          </span>
                        ))}
                      </p>
                    )}
                  </td>

                  {/* 4. Thời hạn đứng riêng: đây là cột người ta lướt tìm màu đỏ/vàng. */}
                  <td className="whitespace-nowrap px-3 py-3">
                    <DueCell dueDate={f.dueDate} closed={f.status === 'CLOSED'} />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-slate-500">
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

/**
 * Gom điều khoản theo tiêu chuẩn: ba dòng "ISO 45001:2018 6.1.2.1 / 6.1.2.2 / 6.1.1"
 * rút thành một dòng "ISO 45001:2018 — 6.1.1, 6.1.2.1, 6.1.2.2".
 *
 * Sắp lại mã theo thứ tự số để đọc thuận mắt: 6.1.1 phải đứng trước 6.1.2.1, mà
 * so sánh chuỗi thì "6.1.10" lại chen lên trước "6.1.2" — nên tách từng đoạn ra
 * so bằng số.
 */
function clauseSummary(clauses: { standard: string; clause: string }[]): string[] {
  const byStandard = new Map<string, string[]>();
  for (const c of clauses) {
    const list = byStandard.get(c.standard) ?? [];
    if (!list.includes(c.clause)) list.push(c.clause);
    byStandard.set(c.standard, list);
  }
  return [...byStandard].map(([standard, list]) => {
    const sorted = [...list].sort(compareClause);
    return `${standard} — ${sorted.join(', ')}`;
  });
}

function compareClause(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
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
