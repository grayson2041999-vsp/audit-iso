'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Unit = { id: string; name: string };

/**
 * Cổng vào của đơn vị được đánh giá: bấm tên đơn vị mình rồi nhập mã 8 số.
 *
 * Dựng theo đúng khuôn `MemberGate` để hai bên nhìn quen mắt như nhau. Khác một
 * chỗ về nguyên tắc: KHÔNG hiện bất cứ nội dung báo cáo nào trước khi nhập mã.
 * Link trần chỉ thấy được danh sách tên đơn vị — thứ vốn không bí mật.
 */
export function UnitGate({ auditId, units }: { auditId: string; units: Unit[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Unit | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/bao-cao/${auditId}/vao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: selected!.id, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không vào được.');
      router.push(`/bao-cao/${auditId}/don-vi`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      setBusy(false);
    }
  }

  if (units.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-500">
        Báo cáo của đợt này chưa được phát hành. Liên hệ trưởng đoàn đánh giá.
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="card p-5">
        <p className="mb-4 text-sm text-slate-600">
          Bấm vào tên đơn vị mình, sau đó nhập mã 8 số do đoàn đánh giá gửi.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {units.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => {
                  setSelected(u);
                  setCode('');
                  setError(null);
                }}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-medium hover:border-brand-400 hover:bg-brand-50/40"
              >
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="card mx-auto max-w-sm p-6">
      <button
        onClick={() => setSelected(null)}
        className="mb-4 text-sm text-slate-500 hover:underline"
      >
        ← Chọn đơn vị khác
      </button>

      <h2 className="font-semibold">{selected.name}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">Nhập mã 8 số được cấp.</p>

      <form onSubmit={submit} className="space-y-4">
        <input
          inputMode="numeric"
          autoFocus
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••••••"
          className="input text-center font-mono text-2xl tracking-[0.3em]"
        />

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={busy || code.length !== 8} className="btn-primary w-full">
          {busy ? 'Đang kiểm tra…' : 'Xem báo cáo'}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-slate-400">
        Quên mã? Hỏi đoàn đánh giá — mã luôn tra lại được.
      </p>
    </div>
  );
}
