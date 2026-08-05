'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SEVERITY_LABELS } from '@/lib/iso';
import { suggestDueDate } from '@/lib/types';
import { SeverityBadge } from './Badge';

type Clause = { standard: string; clause: string; clauseTitle: string };

type Finding = {
  id: string;
  code: string | null;
  status: string;
  title: string | null;
  severity: string | null;
  statement: string | null;
  evidence: string[];
  clauses: Clause[];
  rawArea: string | null;
  dueDate: string | null;
};

const STATUS_FLOW = [
  { id: 'DRAFT', label: 'Bản nháp (đánh giá viên đang soạn)' },
  { id: 'SUBMITTED', label: 'Đã nộp' },
  { id: 'REVIEWED', label: 'Đã rà soát' },
  { id: 'CLOSED', label: 'Đã đóng' },
];

/**
 * Bộ soạn thảo dùng chung cho cả hai vai trò.
 *
 *  · Trưởng đoàn : sửa finding của bất kỳ ai, đổi được cả trạng thái.
 *  · Đánh giá viên: chỉ sửa finding của mình và chỉ khi còn là bản nháp;
 *                   trạng thái do nút "Nộp" ở trên quyết định, không cho chọn tay.
 *
 * Quyền thực sự được kiểm tra ở phía máy chủ — props dưới đây chỉ quyết định
 * hiển thị. Mọi lần lưu đều ghi một bản chụp vào lịch sử chỉnh sửa.
 */
export function FindingEditor({
  endpoint, backHref, finding, canEditStatus, disabledReason,
}: {
  /** Đường dẫn API để PATCH và DELETE finding này. */
  endpoint: string;
  /** Nơi quay về sau khi xoá. */
  backHref: string;
  finding: Finding;
  canEditStatus: boolean;
  /** Có giá trị thì khoá toàn bộ, hiện lý do. */
  disabledReason?: string | null;
}) {
  const router = useRouter();

  const [draft, setDraft] = useState({
    title: finding.title ?? '',
    severity: finding.severity ?? 'MINOR',
    statement: finding.statement ?? '',
    evidence: finding.evidence.join('\n'),
    rawArea: finding.rawArea ?? '',
    dueDate: finding.dueDate ?? '',
    status: finding.status,
  });

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    draft.title !== (finding.title ?? '') ||
    draft.severity !== (finding.severity ?? 'MINOR') ||
    draft.statement !== (finding.statement ?? '') ||
    draft.evidence !== finding.evidence.join('\n') ||
    draft.rawArea !== (finding.rawArea ?? '') ||
    draft.dueDate !== (finding.dueDate ?? '') ||
    (canEditStatus && draft.status !== finding.status);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          severity: draft.severity,
          statement: draft.statement,
          evidence: draft.evidence.split('\n').filter(Boolean),
          rawArea: draft.rawArea,
          dueDate: draft.dueDate || null,
          ...(canEditStatus ? { status: draft.status } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Không lưu được.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Xoá finding này khỏi đợt? Không khôi phục lại được.')) return;
    setBusy(true);
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      return setError(data.error ?? 'Không xoá được.');
    }
    router.push(backHref);
  }

  if (disabledReason) {
    return (
      <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-700">{disabledReason}</p>
    );
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge value={draft.severity} />
        <select
          value={draft.severity}
          onChange={(e) => {
            const sev = e.target.value;
            setDraft((d) => ({
              ...d,
              severity: sev,
              // Đổi mức độ mà chưa có hạn thì gợi ý hạn tương ứng.
              dueDate: d.dueDate || suggestDueDate(sev),
            }));
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {canEditStatus && (
          <select
            value={draft.status}
            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {STATUS_FLOW.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      <Field label="Tiêu đề">
        <input
          className="input"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
      </Field>

      <Field label="Phát biểu finding">
        <textarea
          rows={6}
          className="input"
          value={draft.statement}
          onChange={(e) => setDraft((d) => ({ ...d, statement: e.target.value }))}
        />
      </Field>

      <Field label="Bằng chứng khách quan">
        <textarea
          rows={4}
          className="input"
          value={draft.evidence}
          onChange={(e) => setDraft((d) => ({ ...d, evidence: e.target.value }))}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nơi phát hiện">
          <input
            className="input"
            value={draft.rawArea}
            onChange={(e) => setDraft((d) => ({ ...d, rawArea: e.target.value }))}
          />
        </Field>
        <Field label="Thời hạn khắc phục">
          <input
            type="date"
            className="input"
            value={draft.dueDate}
            onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
          />
        </Field>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
        <button onClick={save} disabled={busy || !dirty} className="btn-primary">
          {busy ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu thay đổi'}
        </button>
        <button onClick={remove} disabled={busy} className="btn-ghost !text-red-600 hover:!bg-red-50">
          Xoá finding
        </button>
        {dirty && <span className="text-xs text-amber-600">Có thay đổi chưa lưu</span>}
      </div>

      <p className="text-xs text-slate-400">
        Mỗi lần lưu, hệ thống chụp lại bản trước đó vào lịch sử chỉnh sửa.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
