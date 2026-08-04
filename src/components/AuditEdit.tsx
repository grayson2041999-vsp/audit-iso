'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STANDARD_LABELS, type StandardCode } from '@/lib/iso';
import { formatDayLong, listDays } from '@/lib/plan';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

type Values = {
  organization: string;
  title: string;
  scope: string;
  standards: StandardCode[];
  leadAuditor: string;
  startDate: string;
  endDate: string;
};

/**
 * Sửa thông tin gốc của đợt — kể cả ngày tháng.
 *
 * Trước đây những trường này chỉ nhập được lúc tạo, mà ngày tháng lại là thứ
 * hay đổi nhất khi đơn vị xin dời lịch. Không sửa được nghĩa là phải xoá đợt
 * làm lại, mất luôn phân công và finding đã ghi nhận.
 *
 * Mặc định đóng lại: đây là màn hình để xem, không phải để sửa.
 */
export function AuditEdit({
  auditId, initial, sessionsPerDay,
}: {
  auditId: string;
  initial: Values;
  /** Số phiên đang xếp trên từng ngày, để xem trước lịch sẽ dời đi đâu. */
  sessionsPerDay: Record<string, number>;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateInvalid = Boolean(v.startDate && v.endDate && v.endDate < v.startDate);
  const days =
    v.startDate && v.endDate && !dateInvalid
      ? Math.round((new Date(v.endDate).getTime() - new Date(v.startDate).getTime()) / 86_400_000) + 1
      : 0;

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  /**
   * Xem trước việc dời lịch. Ghép theo THỨ TỰ ngày trong đợt: ngày 1 vẫn là
   * ngày 1, chỉ đổi ngày dương lịch. Tính lại đúng luật của máy chủ để trưởng
   * đoàn thấy trước kết quả thay vì bấm Lưu rồi mới biết.
   */
  const preview = useMemo(() => {
    if (dateInvalid) return null;
    if (v.startDate === initial.startDate && v.endDate === initial.endDate) return null;

    const oldDays = listDays(initial.startDate, initial.endDate);
    const newDays = listDays(v.startDate, v.endDate);

    const moves = oldDays
      .map((day, i) => ({ from: day, to: newDays[i] ?? null, count: sessionsPerDay[day] ?? 0 }))
      .filter((m) => m.count > 0 || m.to === null);

    const lostCount = moves.filter((m) => m.to === null).reduce((n, m) => n + m.count, 0);
    const movedCount = moves
      .filter((m) => m.to !== null && m.to !== m.from)
      .reduce((n, m) => n + m.count, 0);

    return {
      moves: moves.filter((m) => m.count > 0 && m.to !== null && m.to !== m.from),
      lost: moves.filter((m) => m.to === null && m.count > 0),
      lostCount,
      movedCount,
      extraDays: Math.max(0, newDays.length - oldDays.length),
    };
  }, [v.startDate, v.endDate, initial.startDate, initial.endDate, sessionsPerDay, dateInvalid]);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setError(null);
    if (v.standards.length === 0) return setError('Chọn ít nhất một tiêu chuẩn.');
    if (dateInvalid) return setError('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.');

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
      <button onClick={() => setOpen(true)} className="text-sm text-brand-600 hover:underline">
        Sửa thông tin đợt
      </button>
    );
  }

  return (
    <section className="card space-y-5 p-5">
      <h2 className="font-semibold">Sửa thông tin đợt</h2>

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
        <label className="label">Thời gian đánh giá</label>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <span className="mb-1 block text-xs text-slate-500">Từ ngày</span>
            <input
              type="date"
              className="input"
              value={v.startDate}
              onChange={(e) => {
                const next = e.target.value;
                setV((prev) => ({
                  ...prev,
                  startDate: next,
                  endDate: prev.endDate && next > prev.endDate ? next : prev.endDate,
                }));
              }}
            />
          </div>
          <span className="mt-5 text-slate-400">→</span>
          <div>
            <span className="mb-1 block text-xs text-slate-500">Đến ngày</span>
            <input
              type="date"
              className="input"
              value={v.endDate}
              min={v.startDate || undefined}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </div>
          {days > 0 && <span className="mt-5 text-sm text-slate-500">{days} ngày</span>}
        </div>

        {preview && (
          <div
            className={`mt-2 rounded-lg px-3 py-2.5 text-xs ${
              preview.lostCount > 0 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'
            }`}
          >
            {preview.moves.length > 0 && (
              <>
                <p className="font-medium">
                  Lịch dời theo, giữ nguyên thứ tự ngày ({preview.movedCount} phiên):
                </p>
                <ul className="mt-1 space-y-0.5">
                  {preview.moves.map((m, i) => (
                    <li key={m.from}>
                      • Ngày {i + 1}: {formatDayLong(m.from)} → <strong>{formatDayLong(m.to!)}</strong>{' '}
                      ({m.count} phiên)
                    </li>
                  ))}
                </ul>
              </>
            )}

            {preview.extraDays > 0 && (
              <p className={preview.moves.length > 0 ? 'mt-1.5' : ''}>
                Thêm {preview.extraDays} ngày trống ở cuối đợt để bạn xếp tiếp.
              </p>
            )}

            {preview.lostCount > 0 && (
              <p className={preview.moves.length > 0 ? 'mt-1.5 font-medium' : 'font-medium'}>
                Rút ngắn đợt sẽ bỏ mất {preview.lost.map((m) => formatDayLong(m.from)).join(', ')},
                đang có {preview.lostCount} phiên. Sang tab Chương trình dời hoặc bỏ các phiên đó
                trước — hệ thống sẽ không tự xoá.
              </p>
            )}

            {preview.moves.length === 0 &&
              preview.lostCount === 0 &&
              preview.extraDays === 0 && <p>Chưa có phiên nào bị ảnh hưởng.</p>}

            <p className="mt-1.5 opacity-80">Finding đã ghi nhận không gắn với ngày nên không đổi.</p>
          </div>
        )}
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
        <button onClick={save} disabled={busy || dateInvalid || !dirty} className="btn-primary">
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
