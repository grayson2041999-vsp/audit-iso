'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AuditLockButton({ auditId, closed }: { auditId: string; closed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const message = closed
      ? 'Mở lại đợt đánh giá? Đánh giá viên sẽ ghi nhận và sửa được trở lại.'
      : 'Khoá đợt đánh giá?\n\nSau khi khoá, không ai ghi nhận hay sửa finding được nữa — kể cả bạn. Vẫn mở lại được nếu cần.';
    if (!confirm(message)) return;

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/audits/${auditId}/khoa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closed: !closed }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Không thực hiện được.');
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <button onClick={toggle} disabled={busy} className={closed ? 'btn-primary' : 'btn-ghost'}>
        {busy ? 'Đang xử lý…' : closed ? 'Mở lại đợt' : 'Khoá đợt'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
