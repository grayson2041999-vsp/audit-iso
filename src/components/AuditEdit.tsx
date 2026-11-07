'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STANDARD_LABELS, type StandardCode } from '@/lib/iso';
import { formatDayList } from '@/lib/plan';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

type Values = {
  organization: string;
  title: string;
  scope: string;
  standards: StandardCode[];
  leadAuditor: string;
};

/**
 * Sửa thông tin gốc của đợt.
 *
 * Ngày thực hiện chỉ HIỆN ở đây, sửa ở tab Chương trình: thêm, đổi, xoá ngày
 * đều kéo theo các phiên nằm trên ngày đó, nên phải làm cùng chỗ với lịch.
 *
 * Mặc định đóng lại: đây là màn hình để xem, không phải để sửa.
 */
export function AuditEdit({
  auditId, initial, days,
}: {
  auditId: string;
  initial: Values;
  /** Ngày thực hiện hiện tại ("YYYY-MM-DD"), chỉ để hiển thị. */
  days: string[];
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
        <p className="text-sm">
          <span className="font-medium">{days.length > 0 ? formatDayList(days) : '—'}</span>
          {days.length > 0 && <span className="ml-2 text-slate-500">({days.length} ngày)</span>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Thêm, đổi hoặc xoá ngày ở tab{' '}
          <Link href={`/quan-ly/dot/${auditId}/chuong-trinh`} className="text-brand-700 hover:underline">
            Chương trình
          </Link>
          .
        </p>
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
