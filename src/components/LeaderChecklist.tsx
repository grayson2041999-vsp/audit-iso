'use client';

import { useState } from 'react';
import { ChecklistBuilder } from './ChecklistBuilder';

type Unit = { id: string; name: string; auditors: string[]; minutes: number | null };

/**
 * Tab Checklist đánh giá của trưởng đoàn: chọn đơn vị ở cột trái, soạn ở bên phải.
 *
 * Đơn vị nào đã mở thì khung soạn của nó được giữ nguyên (chỉ ẩn đi) khi chuyển
 * sang đơn vị khác — checklist đang soạn dở hay vừa sinh xong không bị mất khi
 * qua lại giữa các đơn vị. Câu trả lời thì còn được nhớ trên trình duyệt.
 */
export function LeaderChecklist({
  auditId, standards, locked, units,
}: {
  auditId: string;
  standards: string[];
  locked: boolean;
  units: Unit[];
}) {
  const [active, setActive] = useState<string | null>(units[0]?.id ?? null);
  const [opened, setOpened] = useState<string[]>(units[0] ? [units[0].id] : []);

  function open(id: string) {
    setActive(id);
    setOpened((o) => (o.includes(id) ? o : [...o, id]));
  }

  if (locked) {
    return (
      <div className="card p-7 text-sm text-slate-500 sm:p-8">
        Đợt đã khoá, không soạn checklist được nữa. Mở lại đợt nếu cần soạn thêm.
      </div>
    );
  }
  if (units.length === 0) {
    return (
      <div className="card p-7 text-sm text-slate-500 sm:p-8">
        Đợt chưa có đơn vị nào. Thêm đơn vị ở tab Thiết lập đợt đánh giá trước.
      </div>
    );
  }

  const current = units.find((u) => u.id === active);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20">
        {/* Điện thoại: ô chọn */}
        <label className="block lg:hidden">
          <span className="label">Đơn vị</span>
          <select value={active ?? ''} onChange={(e) => open(e.target.value)} className="input">
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        {/* Màn hình rộng: danh sách đơn vị */}
        <nav className="card hidden max-h-[calc(100vh-7rem)] overflow-y-auto p-2 lg:block">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">Chọn đơn vị</p>
          {units.map((u) => {
            const on = u.id === active;
            return (
              <button
                key={u.id}
                onClick={() => open(u.id)}
                className={`block w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                  on ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-frost'
                }`}
              >
                <span className={`block truncate text-sm ${on ? 'font-semibold text-brand-800' : 'font-medium text-ink'}`}>
                  {u.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                  {u.auditors.length > 0 ? u.auditors.join(', ') : 'Chưa phân công'}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0 space-y-4">
        {current && (
          <p className="text-sm text-slate-500">
            Đánh giá viên:{' '}
            <span className="text-ink">
              {current.auditors.length > 0 ? current.auditors.join(', ') : 'chưa phân công'}
            </span>
            {' · '}
            {current.minutes
              ? `Thời lượng theo lịch: ${current.minutes} phút`
              : 'Chưa xếp lịch — số dòng ước theo 75 phút'}
          </p>
        )}

        {opened.map((id) => {
          const u = units.find((x) => x.id === id);
          if (!u) return null;
          return (
            <div key={id} hidden={id !== active}>
              <ChecklistBuilder auditId={auditId} unitId={id} unitName={u.name} standards={standards} asLeader />
            </div>
          );
        })}
      </section>
    </div>
  );
}
