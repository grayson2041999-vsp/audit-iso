'use client';

import { useMemo, useState } from 'react';
import {
  ISO_CLAUSES, STANDARD_SHORT, STANDARD_DOMAIN, STANDARD_STYLE,
  isValidClause, sortStandards, type StandardCode,
} from '@/lib/iso';
import { searchNormalize } from '@/lib/utils';

export type Clause = { standard: string; clause: string; clauseTitle: string };

const ALL_STANDARDS = Object.keys(STANDARD_SHORT) as StandardCode[];

/**
 * Sửa danh sách điều khoản viện dẫn của một finding.
 *
 * VÌ SAO CẦN CÓ. Trước đây điều khoản là thứ DUY NHẤT trong finding mà không ai
 * sửa được sau khi lưu — auditor không, trưởng đoàn cũng không. AI chọn gì thì
 * nằm nguyên đó cho tới lúc in ra báo cáo.
 *
 * Đó là chỗ hở nguy hiểm nhất, vì danh mục điều khoản chỉ chặn được loại sai
 * "mã không tồn tại". Loại sai còn lại — mã có thật nhưng viện dẫn sai chỗ, ví
 * dụ lấy 7.5.3 Kiểm soát thông tin dạng văn bản cho một vấn đề mà bản chất là
 * 9.1.3 Phân tích và đánh giá — thì không phép kiểm tra tự động nào bắt được.
 * Nó cần con người đọc và phán xét, nên con người phải sửa được.
 *
 * Chỉ chọn từ danh mục, không cho gõ tay mã mới: gõ tay là mở lại đúng cái cửa
 * mà phần hậu kiểm đang cố đóng.
 */
export function ClausePicker({
  value, onChange, standards, disabled = false,
}: {
  value: Clause[];
  onChange: (next: Clause[]) => void;
  /** Tiêu chuẩn đã khai báo cho finding — thu hẹp danh mục về đúng phạm vi đợt. */
  standards?: string[];
  disabled?: boolean;
}) {
  const scoped = sortStandards(standards ?? []);
  const [wide, setWide] = useState(false);
  const pool = wide || scoped.length === 0 ? ALL_STANDARDS : scoped;

  const [activeStd, setActiveStd] = useState<StandardCode>(pool[0]);
  const [q, setQ] = useState('');

  const active = pool.includes(activeStd) ? activeStd : pool[0];

  const results = useMemo(() => {
    const needle = searchNormalize(q);
    const rows = ISO_CLAUSES[active];
    if (!needle) return rows;
    return rows.filter(([code, title]) => searchNormalize(`${code} ${title}`).includes(needle));
  }, [active, q]);

  const isPicked = (code: StandardCode, clause: string) =>
    value.some(
      (c) => c.clause === clause && (c.standard === STANDARD_SHORT[code] || c.standard === code),
    );

  function add(code: StandardCode, clause: string, clauseTitle: string) {
    if (disabled || isPicked(code, clause)) return;
    onChange([...value, { standard: STANDARD_SHORT[code], clause, clauseTitle }]);
    setQ('');
  }

  function removeAt(i: number) {
    if (disabled) return;
    onChange(value.filter((_, j) => j !== i));
  }

  /** Đưa lên đầu — vị trí đầu tiên là điều khoản phù hợp nhất, và báo cáo lấy theo đó. */
  function toTop(i: number) {
    if (disabled || i === 0) return;
    const next = [...value];
    const [moved] = next.splice(i, 1);
    onChange([moved, ...next]);
  }

  return (
    <div className="space-y-3">
      {/* ---------------- Danh sách đã chọn ---------------- */}
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Chưa viện dẫn điều khoản nào. Finding không có viện dẫn thì bên được đánh giá
          không biết đối chiếu vào đâu.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((c, i) => {
            const known = isValidClause(c.standard, c.clause);
            return (
              <li
                key={`${c.standard}-${c.clause}-${i}`}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                  known ? 'border-slate-200' : 'border-amber-300 bg-amber-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-brand-700">
                      {c.standard} — {c.clause}
                    </span>
                    {i === 0 && value.length > 1 && (
                      <span className="chip bg-brand-50 text-brand-700 ring-brand-600/20">
                        Phù hợp nhất
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">{c.clauseTitle}</p>
                  {!known && (
                    <p className="mt-1 text-xs font-medium text-amber-800">
                      Mã này không có trong danh mục — kiểm tra lại rồi chọn mã đúng bên dưới.
                    </p>
                  )}
                </div>

                {!disabled && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Xoá
                    </button>
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => toTop(i)}
                        className="whitespace-nowrap text-xs text-slate-500 hover:underline"
                      >
                        Lên đầu
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {value.length > 1 && (
        <p className="text-xs text-slate-400">
          Điều khoản ở vị trí đầu là điều khoản phù hợp nhất — đây là mã được dùng khi
          tổng hợp báo cáo.
        </p>
      )}

      {/* ---------------- Chọn thêm ---------------- */}
      {!disabled && (
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            {pool.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveStd(s)}
                className={`chip ${
                  s === active
                    ? STANDARD_STYLE[s]
                    : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {STANDARD_SHORT[s]}
                <span className="ml-1 font-normal opacity-70">{STANDARD_DOMAIN[s]}</span>
              </button>
            ))}
          </div>

          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo mã hoặc tên điều khoản (gõ không dấu cũng được)…"
          />

          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
            {results.length === 0 && (
              <li className="px-1 py-2 text-sm text-slate-400">
                Không có điều khoản nào khớp “{q}”.
              </li>
            )}
            {results.map(([code, title]) => {
              const picked = isPicked(active, code);
              return (
                <li key={code}>
                  <button
                    type="button"
                    disabled={picked}
                    onClick={() => add(active, code, title)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm ${
                      picked
                        ? 'cursor-default text-slate-400'
                        : 'hover:bg-brand-50/60 active:bg-brand-50'
                    }`}
                  >
                    <span className="w-16 shrink-0 font-mono text-xs text-brand-700">{code}</span>
                    <span className="min-w-0 flex-1">{title}</span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {picked ? 'đã chọn' : '+ thêm'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {scoped.length > 0 && scoped.length < ALL_STANDARDS.length && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={wide}
                onChange={(e) => setWide(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-600"
              />
              {/*
                Một ghi nhận có thể chạm sang tiêu chuẩn không khai báo cho finding —
                ví dụ hoá chất rò rỉ vừa là 14001 vừa là 45001. Mặc định thu hẹp cho
                gọn, nhưng không được khoá cứng.
              */}
              Hiện cả tiêu chuẩn ngoài phạm vi đã khai báo cho finding này
            </label>
          )}
        </div>
      )}
    </div>
  );
}
