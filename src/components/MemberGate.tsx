'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Member = { id: string; fullName: string };

/**
 * Cổng vào của đánh giá viên: bấm tên mình rồi nhập mã 6 số.
 * Không có tài khoản, không mật khẩu — chủ ý để giảm ma sát cho người
 * mỗi năm chỉ dùng app vài lần.
 */
export function MemberGate({ auditId, members }: { auditId: string; members: Member[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Member | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/dot/${auditId}/vao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: selected!.id, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không vào được.');
      router.push(`/dot/${auditId}/toi`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      setBusy(false);
    }
  }

  if (members.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-500">
        Đợt này chưa có đánh giá viên nào được cấp mã. Liên hệ trưởng đoàn.
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="card p-5">
        <p className="mb-4 text-sm text-slate-600">
          Đánh giá viên vui lòng bấm vào tên mình, sau đó nhập mã 6 số do trưởng đoàn gửi
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => {
                  setSelected(m);
                  setCode('');
                  setError(null);
                }}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-medium hover:border-brand-400 hover:bg-brand-50/40"
              >
                {m.fullName}
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
        ← Chọn tên khác
      </button>

      <h2 className="font-semibold">{selected.fullName}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">Nhập mã 6 số được cấp.</p>

      <form onSubmit={submit} className="space-y-4">
        <input
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          className="input text-center font-mono text-2xl tracking-[0.4em]"
        />

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full">
          {busy ? 'Đang kiểm tra…' : 'Vào đợt đánh giá'}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-slate-400">
        Quên mã? Hỏi trưởng đoàn — mã luôn tra lại được.
      </p>
    </div>
  );
}
