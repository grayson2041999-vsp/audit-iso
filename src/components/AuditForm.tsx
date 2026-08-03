'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STANDARD_LABELS, type StandardCode } from '@/lib/iso';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

const today = () => new Date().toISOString().slice(0, 10);

export function AuditForm({ leaderName }: { leaderName: string }) {
  const router = useRouter();

  const [code, setCode] = useState(`IA-${new Date().getFullYear()}-`);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [standards, setStandards] = useState<StandardCode[]>(['ISO9001']);
  const [leadAuditor, setLeadAuditor] = useState(leaderName);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateInvalid = Boolean(startDate && endDate && endDate < startDate);

  const days =
    startDate && endDate && !dateInvalid
      ? Math.round(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000,
        ) + 1
      : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (standards.length === 0) return setError('Chọn ít nhất một tiêu chuẩn.');
    if (dateInvalid) return setError('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.');

    setBusy(true);
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, title, scope, standards, leadAuditor, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không tạo được đợt đánh giá.');
      router.push('/quan-ly');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Mã đợt *</label>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="IA-2026-01"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Tên đợt đánh giá *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Đánh giá nội bộ định kỳ Quý III/2026"
            required
          />
        </div>
      </div>

      <div>
        <label className="label">Thời gian đánh giá *</label>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <span className="mb-1 block text-xs text-slate-500">Từ ngày</span>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate && e.target.value > endDate) setEndDate(e.target.value);
              }}
              required
            />
          </div>
          <span className="mt-5 text-slate-400">→</span>
          <div>
            <span className="mb-1 block text-xs text-slate-500">Đến ngày</span>
            <input
              type="date"
              className="input"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
          {days > 0 && (
            <span className="mt-5 text-sm text-slate-500">
              {days} ngày
            </span>
          )}
        </div>
        {dateInvalid && (
          <p className="mt-1.5 text-sm text-red-600">
            Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.
          </p>
        )}
      </div>

      <div>
        <label className="label">Trưởng đoàn đánh giá *</label>
        <input
          className="input"
          value={leadAuditor}
          onChange={(e) => setLeadAuditor(e.target.value)}
          required
        />
        <p className="mt-1 text-xs text-slate-400">
          Tự điền theo tài khoản. Sửa được nếu người ký báo cáo là người khác.
        </p>
      </div>

      <div>
        <label className="label">Tiêu chuẩn áp dụng *</label>
        <div className="space-y-2">
          {STANDARDS.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-2.5 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={standards.includes(s)}
                onChange={() =>
                  setStandards((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                  )
                }
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>{STANDARD_LABELS[s]}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Đánh giá viên sẽ được điền sẵn các tiêu chuẩn này khi ghi nhận finding.
        </p>
      </div>

      <div>
        <label className="label">Phạm vi đánh giá</label>
        <textarea
          rows={3}
          className="input"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="Toàn bộ các quá trình thuộc phạm vi hệ thống quản lý tích hợp…"
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy || dateInvalid} className="btn-primary">
          {busy ? 'Đang tạo…' : 'Tạo đợt đánh giá'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">
          Huỷ
        </button>
      </div>

      <p className="border-t border-slate-100 pt-4 text-xs text-slate-400">
        Tạo xong, đợt ở trạng thái <strong>Đang chuẩn bị</strong>. Bước tiếp theo là khai báo
        đơn vị được đánh giá và đánh giá viên, rồi phân công — làm ở đợt phát triển sau.
      </p>
    </form>
  );
}
