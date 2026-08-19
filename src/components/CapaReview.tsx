'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SeverityBadge } from './Badge';
import { CAPA_LABEL_LEADER, CAPA_STYLE, currentPhase, type CapaStatus } from '@/lib/capa';
import { cn, formatDateOnly } from '@/lib/utils';
import type { CapaAttachment } from '@/lib/schema';

export type ReviewItem = {
  id: string;
  code: string | null;
  severity: string | null;
  title: string | null;
  statement: string | null;
  dueDate: string | null;
  immediateAction: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  targetDate: string | null;
  completionNote: string | null;
  attachments: CapaAttachment[];
  verdict: 'OK' | 'NG' | null;
  leaderNote: string | null;
};

/**
 * Màn duyệt của trưởng đoàn, dùng chung cho CẢ HAI MỐC.
 *
 * Đang duyệt kế hoạch hay xác nhận hiệu lực thì suy từ `status` — cùng cách với
 * phía máy chủ, để hai bên không bao giờ hiểu khác nhau về mốc hiện tại.
 *
 * Đơn vị nộp cả gói, nhưng ở đây trưởng đoàn chấm ĐẠT/CHƯA ĐẠT tới từng mục.
 * Đó là phần bù cho việc nộp gói: trả lại cả gói nhưng đơn vị biết chính xác
 * chỗ nào phải sửa, không mò.
 */
export function CapaReview({
  auditId,
  unitId,
  status,
  reviewNote,
  items: initial,
}: {
  auditId: string;
  unitId: string;
  status: CapaStatus;
  reviewNote: string | null;
  items: ReviewItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phase = currentPhase(status);
  const canAct = status === 'PLAN_SUBMITTED' || status === 'EVIDENCE_SUBMITTED';
  const ngCount = items.filter((it) => it.verdict === 'NG').length;

  function setItem(id: string, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function send(action: 'approve' | 'reject') {
    if (action === 'reject' && note.trim().length < 5) {
      return setError('Nhập lý do trả lại — đơn vị cần biết phải sửa gì.');
    }
    if (action === 'approve' && phase === 'evidence') {
      if (!confirm('Xác nhận hành động khắc phục đã có hiệu lực và đóng hồ sơ?')) return;
    }

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/audits/${auditId}/khac-phuc/${unitId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        note: note.trim(),
        verdicts: items.map((it) => ({
          itemId: it.id,
          verdict: it.verdict,
          leaderNote: it.leaderNote ?? '',
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Không xử lý được.');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <span className={cn('chip', CAPA_STYLE[status])}>{CAPA_LABEL_LEADER[status]}</span>
          <span className="ml-3 text-sm text-slate-500">
            {phase === 'plan'
              ? 'Mốc 1 — duyệt kế hoạch khắc phục'
              : phase === 'evidence'
                ? 'Mốc 2 — xác nhận hiệu lực'
                : 'Hồ sơ đã đóng'}
          </span>
        </div>
        {!canAct && reviewNote && (
          <p className="text-sm text-slate-500">Ghi chú gần nhất: {reviewNote}</p>
        )}
      </div>

      {items.length === 0 && (
        <div className="card p-6 text-sm text-slate-500">
          Không còn mục nào cần khắc phục — có thể các finding đã được hạ mức ở bản phát hành mới.
        </div>
      )}

      {items.map((it, i) => (
        <div key={it.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="font-mono text-sm text-slate-400">{it.code ?? `#${i + 1}`}</span>
              <span className="ml-2 font-medium">{it.title ?? 'Chưa có tiêu đề'}</span>
            </div>
            <SeverityBadge value={it.severity} />
          </div>

          {it.statement && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {it.statement}
            </p>
          )}

          <dl className="mt-4 space-y-3 text-sm">
            <Field label="Xử lý ngay" value={it.immediateAction} />
            <Field label="Nguyên nhân gốc" value={it.rootCause} />
            <Field label="Hành động khắc phục" value={it.actionPlan} />
            <Field label="Thời hạn đơn vị cam kết" value={formatDateOnly(it.targetDate)} />
            {phase !== 'plan' && (
              <>
                <Field label="Kết quả đã thực hiện" value={it.completionNote} />
                {it.attachments.length > 0 && (
                  <div>
                    <dt className="text-xs font-medium uppercase text-slate-400">Tệp đính kèm</dt>
                    <dd className="mt-1 text-slate-700">
                      {it.attachments.map((a) => a.fileName ?? a.key).join(' · ')}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>

          {canAct ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <span className="text-sm text-slate-500">Đánh giá mục này:</span>
              <Choice
                active={it.verdict === 'OK'}
                tone="ok"
                onClick={() => setItem(it.id, { verdict: it.verdict === 'OK' ? null : 'OK' })}
              >
                Đạt
              </Choice>
              <Choice
                active={it.verdict === 'NG'}
                tone="ng"
                onClick={() => setItem(it.id, { verdict: it.verdict === 'NG' ? null : 'NG' })}
              >
                Chưa đạt
              </Choice>
              {it.verdict === 'NG' && (
                <input
                  value={it.leaderNote ?? ''}
                  onChange={(e) => setItem(it.id, { leaderNote: e.target.value })}
                  placeholder="Cần sửa gì ở mục này?"
                  className="input mt-2 w-full"
                />
              )}
            </div>
          ) : (
            it.verdict && (
              <p className="mt-4 border-t border-slate-100 pt-3 text-sm">
                <span className={it.verdict === 'OK' ? 'text-emerald-700' : 'text-red-700'}>
                  {it.verdict === 'OK' ? 'Đạt' : 'Chưa đạt'}
                </span>
                {it.leaderNote && <span className="text-slate-500"> — {it.leaderNote}</span>}
              </p>
            )
          )}
        </div>
      ))}

      {canAct && (
        <div className="card space-y-3 p-5">
          <label className="label">
            Ý kiến gửi đơn vị{' '}
            <span className="font-normal text-slate-400">(bắt buộc nếu trả lại)</span>
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
            placeholder={
              phase === 'plan'
                ? 'VD: Nguyên nhân gốc ở mục 2 mới dừng ở hiện tượng, đề nghị phân tích sâu hơn.'
                : 'VD: Bằng chứng mục 1 chưa cho thấy quy trình đã được cập nhật.'
            }
          />

          {error && <p className="whitespace-pre-line text-sm text-red-600">{error}</p>}

          {ngCount > 0 && (
            <p className="text-sm text-amber-700">
              Đang đánh dấu {ngCount} mục chưa đạt — phải trả lại hồ sơ, không duyệt được.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => send('approve')}
              disabled={busy || ngCount > 0}
              className="btn-primary"
            >
              {phase === 'plan' ? 'Duyệt kế hoạch' : 'Xác nhận hiệu lực & đóng'}
            </button>
            <button onClick={() => send('reject')} disabled={busy} className="btn-ghost">
              Trả lại đơn vị
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">{value?.trim() || '—'}</dd>
    </div>
  );
}

function Choice({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: 'ok' | 'ng';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const on =
    tone === 'ok'
      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
      : 'border-red-500 bg-red-50 text-red-800';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm transition',
        active ? on : 'border-slate-300 text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}
