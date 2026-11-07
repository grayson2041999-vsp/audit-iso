'use client';

import { useState } from 'react';
import { formatDayList, toDayString } from '@/lib/plan';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/**
 * Lịch tháng để chọn ngày thực hiện: bấm một ngày để chọn, bấm lại để bỏ.
 * Chọn được nhiều ngày không liền nhau, kể cả ở nhiều tháng khác nhau.
 *
 * `value` là danh sách "YYYY-MM-DD", luôn được trả ra đã sắp xếp.
 */
export function DayPicker({
  value, onChange, disabled = false,
}: {
  value: string[];
  onChange: (days: string[]) => void;
  disabled?: boolean;
}) {
  // Mở ở tháng của ngày đầu tiên đã chọn; chưa chọn ngày nào thì mở tháng hiện tại.
  const [month, setMonth] = useState(() => {
    const [y, m] = (value[0] ?? toDayString(new Date())).split('-').map(Number);
    return { y, m: m - 1 };
  });

  const selected = new Set(value);
  const today = toDayString(new Date());

  const first = new Date(month.y, month.m, 1);
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  // Tuần bắt đầu từ thứ Hai: getDay() 0 = Chủ nhật → cột cuối.
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDayString(new Date(month.y, month.m, i + 1))),
  ];

  const shift = (delta: number) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  function toggle(day: string) {
    if (disabled) return;
    const next = selected.has(day) ? value.filter((x) => x !== day) : [...value, day];
    onChange([...new Set(next)].sort());
  }

  return (
    <div className="space-y-2">
      <div className="w-full max-w-xs rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
            aria-label="Tháng trước"
          >
            ‹
          </button>
          <span className="text-sm font-semibold">
            Tháng {month.m + 1}/{month.y}
          </span>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
            aria-label="Tháng sau"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1 font-medium text-slate-400">
              {w}
            </span>
          ))}
          {cells.map((day, i) => {
            if (!day) return <span key={`x${i}`} />;
            const on = selected.has(day);
            const weekend = i % 7 >= 5;
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggle(day)}
                disabled={disabled}
                aria-pressed={on}
                className={`h-8 rounded-lg text-sm tabular-nums transition-colors ${
                  on
                    ? 'bg-brand-600 font-semibold text-white hover:bg-brand-700'
                    : `${weekend ? 'text-slate-400' : 'text-slate-700'} hover:bg-slate-100`
                } ${day === today && !on ? 'ring-1 ring-inset ring-brand-300' : ''} disabled:cursor-not-allowed`}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-sm">
        {value.length > 0 ? (
          <>
            <span className="font-medium">{formatDayList(value)}</span>
            <span className="ml-2 text-slate-500">({value.length} ngày)</span>
          </>
        ) : (
          <span className="text-slate-400">Chưa chọn ngày nào</span>
        )}
      </p>
    </div>
  );
}
