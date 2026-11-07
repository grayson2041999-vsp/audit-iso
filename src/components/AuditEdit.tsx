'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STANDARD_LABELS, type StandardCode } from '@/lib/iso';
import { formatDayList } from '@/lib/plan';
import { DayPicker } from '@/components/DayPicker';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

type Values = {
  organization: string;
  title: string;
  scope: string;
  standards: StandardCode[];
  leadAuditor: string;
  /** Ngày thực hiện, "YYYY-MM-DD", đã sắp xếp. */
  days: string[];
};

/**
 * Sửa thông tin gốc của đợt, gồm cả ngày thực hiện. Khoảng giờ từng ngày và
 * lịch chi tiết chỉnh ở tab Chương trình.
 *
 * Mặc định đóng lại: đây là màn hình để xem, không phải để sửa.
 */
export function AuditEdit({
  auditId, initial, sessionCounts,
}: {
  auditId: string;
  initial: Values;
  /** Số phiên trong lịch (không tính hai cuộc họp) theo từng ngày — để hỏi lại trước khi bỏ ngày. */
  sessionCounts: Record<string, number>;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setError(null);
    if (v.standards.length === 0) return setError('Chọn ít nhất một tiêu chuẩn.');
    if (v.days.length === 0) return setError('Chọn ít nhất một ngày thực hiện.');

    const dropped = initial.days.filter((x) => !v.days.includes(x) && (sessionCounts[x] ?? 0) > 0);
    if (dropped.length > 0) {
      const n = dropped.reduce((sum, x) => sum + sessionCounts[x], 0);
      const ok = confirm(
        `${dropped.length > 1 ? 'Các ngày' : 'Ngày'} ${formatDayList(dropped)} đang có ${n} phiên trong lịch. ` +
          `Bỏ ${dropped.length > 1 ? 'các ngày này' : 'ngày này'} thì ${n} phiên đó bị xoá khỏi lịch.\n\nTiếp tục?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/audits/${auditId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Không lưu được.');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-brand-700 hover:underline">
        Sửa thông tin đợt
      </button>
    );
  }

  return (
    <section className="card space-y-5 p-6 sm:p-7">
      <h2 className="text-lg font-semibold">Sửa thông tin đợt</h2>

      <div>
        <label className="label">Tổ chức được đánh giá</label>
        <input
          className="input"
          value={v.organization}
          onChange={(e) => set('organization', e.target.value)}
        />
      </div>

      <div>
        <label className="label">Tên đợt đánh giá</label>
        <input className="input" value={v.title} onChange={(e) => set('title', e.target.value)} />
      </div>

      <div>
        <label className="label">Ngày thực hiện</label>
        <DayPicker value={v.days} onChange={(days) => set('days', days)} />
      </div>

      <div>
        <label className="label">Trưởng đoàn đánh giá</label>
        <input
          className="input"
          value={v.leadAuditor}
          onChange={(e) => set('leadAuditor', e.target.value)}
        />
      </div>

      <div>
        <label className="label">Tiêu chuẩn áp dụng</label>
        <div className="space-y-2">
          {STANDARDS.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-2.5 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={v.standards.includes(s)}
                onChange={() =>
                  set(
                    'standards',
                    v.standards.includes(s)
                      ? v.standards.filter((x) => x !== s)
                      : [...v.standards, s],
                  )
                }
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>{STANDARD_LABELS[s]}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Phạm vi đánh giá</label>
        <textarea
          rows={3}
          className="input"
          value={v.scope}
          onChange={(e) => set('scope', e.target.value)}
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button onClick={save} disabled={busy || !dirty} className="btn-primary">
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
        <button
          onClick={() => {
            setV(initial);
            setError(null);
            setOpen(false);
          }}
          disabled={busy}
          className="btn-ghost"
        >
          Huỷ
        </button>
      </div>
    </section>
  );
}
