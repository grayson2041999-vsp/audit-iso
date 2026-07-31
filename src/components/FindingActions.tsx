'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STATUS_LABELS } from '@/lib/iso';

const FLOW = ['DRAFT', 'AI_DRAFTED', 'REVIEWED', 'ISSUED', 'CLOSED'] as const;

export function FindingActions({
  id, status, statement,
}: {
  id: string;
  status: string;
  statement: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function changeStatus(next: string) {
    setBusy(true);
    await fetch(`/api/findings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next, note: `Chuyển trạng thái sang ${STATUS_LABELS[next]}` }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm('Xoá finding này? Hành động không thể hoàn tác.')) return;
    setBusy(true);
    await fetch(`/api/findings/${id}`, { method: 'DELETE' });
    router.push('/findings');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => {
          navigator.clipboard.writeText(statement);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="btn-ghost"
      >
        {copied ? 'Đã sao chép' : 'Sao chép phát biểu'}
      </button>

      <select
        value={status}
        disabled={busy}
        onChange={(e) => changeStatus(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        {FLOW.map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>

      <button onClick={remove} disabled={busy} className="btn-ghost !text-red-600 hover:!bg-red-50">
        Xoá
      </button>
    </div>
  );
}
