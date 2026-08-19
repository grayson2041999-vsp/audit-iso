'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SeverityBadge } from './Badge';
import {
  CAPA_LABEL_UNIT, CAPA_STYLE, currentPhase, needsCapa, unitCanEdit, type CapaStatus,
} from '@/lib/capa';
import { cn, formatDateOnly } from '@/lib/utils';
import type { ReleasedFinding } from '@/lib/schema';

export type PortalItem = {
  id: string;
  code: string | null;
  severity: string | null;
  title: string | null;
  statement: string | null;
  clauses: { standard: string; clause: string; clauseTitle: string }[];
  dueDate: string | null;
  immediateAction: string;
  rootCause: string;
  actionPlan: string;
  targetDate: string;
  completionNote: string;
  verdict: 'OK' | 'NG' | null;
  leaderNote: string | null;
};

type Tab = 'unit' | 'org' | 'capa';

/**
 * Cổng của đơn vị được đánh giá.
 *
 * BA TAB, và thứ tự có chủ đích:
 *
 *   1. "Đơn vị của bạn"  — mở ra là thấy ngay, đây là thứ họ cần
 *   2. "Toàn tổ chức"    — xem được, nhưng phải chủ động bấm. Không phơi ra
 *                          mặc định để tránh so bì giữa các đơn vị, thứ khiến
 *                          kỳ sau người ta giấu vấn đề thay vì sửa
 *   3. "Hồ sơ khắc phục" — chỉ hiện khi đơn vị thực sự có sự không phù hợp
 */
export function UnitPortal({
  auditId,
  organization,
  auditTitle,
  unitId,
  unitName,
  version,
  releaseReason,
  releasedAt,
  findings,
  hasReport,
  status,
  round,
  reviewNote,
  responsibleName: initName,
  responsibleTitle: initTitle,
  items: initItems,
}: {
  auditId: string;
  organization: string;
  auditTitle: string;
  unitId: string;
  unitName: string;
  version: number;
  releaseReason: string | null;
  releasedAt: string;
  findings: ReleasedFinding[];
  hasReport: boolean;
  status: CapaStatus;
  round: number;
  reviewNote: string | null;
  responsibleName: string;
  responsibleTitle: string;
  items: PortalItem[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unit');
  const [items, setItems] = useState(initItems);
  const [name, setName] = useState(initName);
  const [title, setTitle] = useState(initTitle);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Lọc theo `unitId` chứ không theo tên. Tên đơn vị có thể bị sửa sau khi phát
   * hành, mà ảnh chụp thì giữ tên cũ — so bằng tên sẽ làm đơn vị đột nhiên
   * không thấy finding nào của mình.
   */
  const mine = useMemo(() => findings.filter((f) => f.unitId === unitId), [findings, unitId]);
  const phase = currentPhase(status);
  const editable = hasReport && unitCanEdit(status);

  function setItem(id: string, patch: Partial<PortalItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function save(submit: boolean) {
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await fetch(`/api/bao-cao/${auditId}/khac-phuc`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submit,
        responsibleName: name,
        responsibleTitle: title,
        items: items.map((it) => ({
          itemId: it.id,
          immediateAction: it.immediateAction,
          rootCause: it.rootCause,
          actionPlan: it.actionPlan,
          targetDate: it.targetDate || null,
          completionNote: it.completionNote,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Không lưu được.');
    if (submit) router.refresh();
    else setMsg('Đã lưu nháp. Chưa gửi cho đoàn đánh giá.');
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-sm text-slate-500">{organization}</p>
        <h1 className="mt-1 text-xl font-semibold">Báo cáo đánh giá nội bộ — {unitName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {auditTitle} · Bản {version} phát hành {formatDateOnly(releasedAt)}
        </p>
        {version > 1 && releaseReason && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Bản {version} thay cho bản trước — lý do: {releaseReason}
          </p>
        )}
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'unit'} onClick={() => setTab('unit')}>
          Đơn vị của bạn ({mine.length})
        </TabButton>
        {hasReport && (
          <TabButton active={tab === 'capa'} onClick={() => setTab('capa')}>
            Hồ sơ khắc phục
          </TabButton>
        )}
        {/* Nút nhỏ, đứng tách sang phải — xem được nhưng không mời gọi. */}
        <button
          onClick={() => setTab('org')}
          className={cn(
            '-mb-px ml-auto border-b-2 px-3 py-2.5 text-xs',
            tab === 'org'
              ? 'border-slate-400 font-medium text-slate-700'
              : 'border-transparent text-slate-400 hover:text-slate-600',
          )}
        >
          Xem toàn tổ chức
        </button>
      </nav>

      {tab === 'unit' && (
        <section className="space-y-3">
          {mine.length === 0 ? (
            <div className="card p-6 text-sm text-slate-500">
              Đợt này không ghi nhận phát hiện nào tại đơn vị của bạn.
            </div>
          ) : (
            mine.map((f) => <FindingCard key={f.id} f={f} />)
          )}
        </section>
      )}

      {tab === 'org' && (
        <section className="space-y-3">
          <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            Toàn bộ phát hiện của đợt, gồm cả các đơn vị khác. Số liệu này để tham khảo và học
            hỏi lẫn nhau — mỗi đơn vị chỉ chịu trách nhiệm khắc phục phần của mình.
          </p>
          {findings.map((f) => (
            <FindingCard key={f.id} f={f} showUnit />
          ))}
        </section>
      )}

      {tab === 'capa' && hasReport && (
        <section className="space-y-4">
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <span className={cn('chip', CAPA_STYLE[status])}>{CAPA_LABEL_UNIT[status]}</span>
              {round > 1 && <span className="ml-2 text-xs text-slate-400">lần {round}</span>}
            </div>
            <p className="text-sm text-slate-500">
              {phase === 'plan'
                ? 'Bước 1 — trình kế hoạch khắc phục'
                : phase === 'evidence'
                  ? 'Bước 2 — nộp bằng chứng đã thực hiện'
                  : 'Hồ sơ đã được đóng'}
            </p>
          </div>

          {reviewNote && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>Ý kiến của đoàn đánh giá:</strong> {reviewNote}
            </div>
          )}

          {phase === 'plan' && (
            <div className="card grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <label className="label">Lãnh đạo đơn vị chịu trách nhiệm</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!editable}
                  className="input"
                  placeholder="Họ và tên"
                />
              </div>
              <div>
                <label className="label">Chức danh</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={!editable}
                  className="input"
                  placeholder="VD: Trưởng phòng Kỹ thuật"
                />
              </div>
            </div>
          )}

          {items.map((it, i) => (
            <CapaCard
              key={it.id}
              index={i}
              item={it}
              phase={phase}
              editable={editable}
              onChange={(patch) => setItem(it.id, patch)}
            />
          ))}

          {error && (
            <p className="whitespace-pre-line rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {msg && (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{msg}</p>
          )}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => save(false)} disabled={busy} className="btn-ghost">
                Lưu nháp
              </button>
              <button onClick={() => save(true)} disabled={busy} className="btn-primary">
                {busy
                  ? 'Đang gửi…'
                  : phase === 'plan'
                    ? 'Gửi kế hoạch cho đoàn đánh giá'
                    : 'Gửi bằng chứng hoàn thành'}
              </button>
            </div>
          )}

          {!editable && status !== 'CLOSED' && (
            <p className="text-sm text-slate-500">
              Hồ sơ đang chờ đoàn đánh giá xử lý. Bạn sẽ sửa được nếu bị trả lại.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2.5 text-sm',
        active
          ? 'border-brand-600 font-medium text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  );
}

function FindingCard({ f, showUnit = false }: { f: ReleasedFinding; showUnit?: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-sm text-slate-400">{f.code}</span>
          <span className="ml-2 font-medium">{f.title ?? 'Chưa có tiêu đề'}</span>
          {showUnit && f.unitName && (
            <span className="ml-2 text-sm text-slate-400">· {f.unitName}</span>
          )}
        </div>
        <SeverityBadge value={f.severity} />
      </div>

      {f.statement && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{f.statement}</p>
      )}

      {f.clauses.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Điều khoản: {f.clauses.map((c) => `${c.standard} ${c.clause}`).join(' · ')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
        {f.rawArea && <span>Nơi phát hiện: {f.rawArea}</span>}
        {needsCapa(f.severity) && f.dueDate && (
          <span>Thời hạn khắc phục: {formatDateOnly(f.dueDate)}</span>
        )}
      </div>
    </div>
  );
}

function CapaCard({
  index,
  item,
  phase,
  editable,
  onChange,
}: {
  index: number;
  item: PortalItem;
  phase: 'plan' | 'evidence' | 'done';
  editable: boolean;
  onChange: (patch: Partial<PortalItem>) => void;
}) {
  const planLocked = phase !== 'plan';

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-sm text-slate-400">{item.code ?? `#${index + 1}`}</span>
          <span className="ml-2 font-medium">{item.title ?? 'Chưa có tiêu đề'}</span>
        </div>
        <SeverityBadge value={item.severity} />
      </div>

      {item.statement && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {item.statement}
        </p>
      )}

      {item.verdict === 'NG' && item.leaderNote && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Mục này chưa đạt — {item.leaderNote}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <Text
          label="Biện pháp xử lý ngay"
          hint="Đã làm gì để xử lý hậu quả trước mắt"
          value={item.immediateAction}
          disabled={!editable || planLocked}
          onChange={(v) => onChange({ immediateAction: v })}
        />
        <Text
          label="Nguyên nhân gốc"
          hint="Vì sao xảy ra — đi tới nguyên nhân hệ thống, không dừng ở hiện tượng"
          value={item.rootCause}
          disabled={!editable || planLocked}
          onChange={(v) => onChange({ rootCause: v })}
        />
        <Text
          label="Hành động khắc phục"
          hint="Làm gì để nguyên nhân trên không tái diễn"
          value={item.actionPlan}
          disabled={!editable || planLocked}
          onChange={(v) => onChange({ actionPlan: v })}
        />

        <div>
          <label className="label">Thời hạn hoàn thành</label>
          <input
            type="date"
            value={item.targetDate}
            disabled={!editable || planLocked}
            onChange={(e) => onChange({ targetDate: e.target.value })}
            className="input max-w-xs"
          />
        </div>

        {phase !== 'plan' && (
          <Text
            label="Kết quả đã thực hiện"
            hint="Mô tả cụ thể việc đã làm và bằng chứng kiểm chứng được (số hiệu tài liệu, ngày tháng)"
            value={item.completionNote}
            disabled={!editable}
            onChange={(v) => onChange({ completionNote: v })}
          />
        )}
      </div>
    </div>
  );
}

function Text({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">
        {label} <span className="font-normal text-slate-400">— {hint}</span>
      </label>
      <textarea
        rows={2}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </div>
  );
}
