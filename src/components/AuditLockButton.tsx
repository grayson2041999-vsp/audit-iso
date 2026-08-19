'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Khoá / mở lại đợt.
 *
 * Mở lại một đợt ĐÃ GỬI báo cáo cho đơn vị là việc khác hẳn về bản chất, nên
 * hộp thoại cũng khác: bắt nhập lý do, và nói rõ rằng sửa xong vẫn phải phát
 * hành bản mới thì đơn vị mới thấy. Máy chủ kiểm lại lý do một lần nữa —
 * `confirm`/`prompt` ở đây chỉ là giao diện.
 */
export function AuditLockButton({
  auditId,
  closed,
  issued = false,
}: {
  auditId: string;
  closed: boolean;
  issued?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    let reason = '';

    if (!closed) {
      if (
        !confirm(
          'Khoá đợt đánh giá?\n\nSau khi khoá, không ai ghi nhận hay sửa finding được nữa — kể cả bạn. Vẫn mở lại được nếu cần.',
        )
      ) {
        return;
      }
    } else if (issued) {
      const input = prompt(
        'Đợt này ĐÃ GỬI báo cáo cho các đơn vị.\n\n' +
          'Mở lại để sửa thì đơn vị vẫn đang xem bản đã gửi — chỉ khi bạn phát hành ' +
          'bản mới họ mới thấy thay đổi.\n\n' +
          'Nhập lý do mở lại (đơn vị sẽ thấy lý do này khi bạn phát hành):',
      );
      if (input === null) return;
      reason = input.trim();
      if (reason.length < 5) {
        setError('Lý do quá ngắn.');
        return;
      }
    } else if (!confirm('Mở lại đợt đánh giá? Đánh giá viên sẽ ghi nhận và sửa được trở lại.')) {
      return;
    }

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/audits/${auditId}/khoa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closed: !closed, reason }),
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
