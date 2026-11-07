'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STANDARD_LABELS, type StandardCode } from '@/lib/iso';
import { DayPicker } from '@/components/DayPicker';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

/** Nhớ tên tổ chức của đợt gần nhất — trưởng đoàn thường đánh giá lại cùng một nơi. */
const ORG_KEY = 'to-chuc-gan-nhat';

export function AuditForm({ leaderName }: { leaderName: string }) {
  const router = useRouter();

  const [organization, setOrganization] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [standards, setStandards] = useState<StandardCode[]>(['ISO9001']);
  const [leadAuditor, setLeadAuditor] = useState(leaderName);
  /** Ngày thực hiện, chọn từng ngày — không cần liền nhau. */
  const [days, setDays] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Điền sẵn tên tổ chức lần trước, tránh mỗi đợt viết một kiểu khác nhau
  // làm hỏng việc tra cứu về sau.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ORG_KEY);
      if (saved) setOrganization(saved);
    } catch {
      /* bộ nhớ trình duyệt bị chặn — bỏ qua */
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (standards.length === 0) return setError('Chọn ít nhất một tiêu chuẩn.');
    if (days.length === 0) return setError('Chọn ít nhất một ngày thực hiện.');

    setBusy(true);
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization, title, scope, standards, leadAuditor, days,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không tạo được đợt đánh giá.');
      try {
        window.localStorage.setItem(ORG_KEY, organization.trim());
      } catch {
        /* bỏ qua */
      }
      router.push('/quan-ly');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-7 sm:p-8">
      <div>
        <label className="label">Tổ chức được đánh giá *</label>
        <input
          className="input"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="Xí nghiệp Dịch vụ Cảng và Cung ứng vật tư thiết bị"
          required
        />
      </div>

      <div>
        <label className="label">Tên đợt đánh giá *</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Đánh giá nội bộ lần ... năm ..."
          required
        />
      </div>

      <div>
        <label className="label">Ngày thực hiện *</label>
        <DayPicker value={days} onChange={setDays} />
      </div>

      <div>
        <label className="label">Trưởng đoàn đánh giá *</label>
        <input
          className="input"
          value={leadAuditor}
          onChange={(e) => setLeadAuditor(e.target.value)}
          required
        />
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
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Đang tạo…' : 'Tạo đợt đánh giá'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">
          Huỷ
        </button>
      </div>
    </form>
  );
}
