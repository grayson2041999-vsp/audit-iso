'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MemberFindingActions({
  auditId, findingId, unitId, status, statement, canSubmit, auditClosed,
}: {
  auditId: string;
  findingId: string;
  unitId: string | null;
  status: string;
  statement: string;
  /** Chưa chuẩn hoá thì chưa nộp được. */
  canSubmit: boolean;
  auditClosed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraft = status === 'DRAFT';

  async function submit() {
    if (
      !confirm(
        'Lưu ý: Sau khi nộp finding này cho trưởng đoàn, bạn sẽ không thể chỉnh sửa nó được nữa.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/dot/${auditId}/findings/${findingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submit: true }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Không nộp được.');
    router.refresh();
  }

  async function remove() {
    if (!confirm('Xoá finding này? Không khôi phục lại được.')) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/dot/${auditId}/findings/${findingId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(data.error ?? 'Không xoá được.');
    }
    router.push(unitId ? `/dot/${auditId}/don-vi/${unitId}` : `/dot/${auditId}/toi`);
  }

  return (
    <div className="flex flex-col items-end gap-2">
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

        {isDraft && !auditClosed && (
          <>
            <button onClick={remove} disabled={busy} className="btn-ghost !text-red-600 hover:!bg-red-50">
              Xoá
            </button>
            <button
              onClick={submit}
              disabled={busy || !canSubmit}
              title={canSubmit ? undefined : 'Cần chuẩn hoá bằng AI trước khi nộp'}
              className="btn-primary"
            >
              {busy ? 'Đang xử lý…' : 'Nộp cho trưởng đoàn'}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
