'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Khoá / mở lại đợt. Khoá chỉ chặn ghi nhận và sửa finding; phần theo dõi khắc
 * phục vẫn cập nhật được sau khi khoá.
 */
export function AuditLockButton({ auditId, closed }: { auditId: string; closed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const ok = closed
      ? confirm('Mở lại đợt đánh giá? Đánh giá viên sẽ ghi nhận và sửa được trở lại.')
      : confirm(
          'Khoá đợt đánh giá?\n\nSau khi khoá, không ai ghi nhận hay sửa finding được nữa — kể cả bạn. ' +
            'Phần theo dõi khắc phục vẫn cập nhật bình thường. Vẫn mở lại được nếu cần.',
        );
    if (!ok) return;

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
      {error && <p className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
