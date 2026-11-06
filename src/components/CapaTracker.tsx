'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SeverityBadge } from './Badge';
import { SEVERITY_LABELS, STANDARD_SHORT, type StandardCode } from '@/lib/iso';
import {
  CAPA_BAR, CAPA_LABEL, CAPA_STATUSES, CAPA_STYLE, daysUntil, dueTone, formatDay, needsCapa, percent,
  type CapaStatus, type DueTone,
} from '@/lib/capa';

export type CapaFinding = {
  id: string;
  code: string | null;
  severity: string;
  title: string;
  statement: string | null;
  unitId: string | null;
  unitName: string;
  /** Thời hạn khắc phục ghi trên finding, "YYYY-MM-DD" — gợi ý cho thời hạn của mục. */
  dueDate: string | null;
  clauses: { standard: string; clause: string; clauseTitle: string }[];
};

export type CapaRow = {
  id: string;
  findingId: string;
  content: string;
  owner: string | null;
  dueDate: string | null;
  status: CapaStatus;
  completedDate: string | null;
  note: string | null;
  updatedAt: string;
};

type Unit = { id: string; name: string };
type Filters = { unit: string; severity: string; status: string; due: '' | 'overdue' | 'soon' };
const NO_FILTER: Filters = { unit: '', severity: '', status: '', due: '' };
/** Khoá nhóm cho finding chưa gán đơn vị. */
const NO_UNIT = '__none__';

const SEVERITY_ORDER = ['MAJOR', 'MINOR', 'OBS', 'OFI'];

/**
 * Theo dõi khắc phục.
 *
 * Ba tầng, từ tổng quát tới chi tiết:
 *  1. Tổng quan — % hoàn thành chung, số mục trễ hạn và sắp đến hạn.
 *  2. Theo đơn vị — mỗi đơn vị bao nhiêu mục, đạt bao nhiêu %. Bấm để lọc.
 *  3. Danh sách mục — lọc theo đơn vị, phân loại, trạng thái, thời hạn; bấm
 *     một dòng để xem finding gốc và sửa chi tiết.
 *
 * Mỗi thay đổi lưu ngay xuống máy chủ — đây là sổ theo dõi, không phải bản nháp.
 */
export function CapaTracker({
  auditId, today, units, findings, initialRows,
}: {
  auditId: string;
  /** Hôm nay theo giờ Việt Nam, tính ở máy chủ để trang không lệch ngày. */
  today: string;
  units: Unit[];
  findings: CapaFinding[];
  initialRows: CapaRow[];
}) {
  const [rows, setRows] = useState<CapaRow[]>(initialRows);
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [editing, setEditing] = useState<{ mode: 'new'; findingId?: string } | { mode: 'edit'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findingById = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  /** Mỗi mục kèm finding gốc, đơn vị và mức cảnh báo thời hạn. */
  const items = useMemo(
    () =>
      rows.flatMap((r) => {
        const f = findingById.get(r.findingId);
        if (!f) return [];
        return [{ ...r, finding: f, unitKey: f.unitId ?? NO_UNIT, tone: dueTone(r, today) }];
      }),
    [rows, findingById, today],
  );
  type Item = (typeof items)[number];

  /* ---------------- Số liệu ---------------- */

  const total = items.length;
  const done = items.filter((i) => i.status === 'DONE').length;
  const overdue = items.filter((i) => i.tone === 'overdue').length;
  const soon = items.filter((i) => i.tone === 'soon').length;
  const byStatus = Object.fromEntries(
    CAPA_STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]),
  ) as Record<CapaStatus, number>;

  /** Sự không phù hợp chưa có mục nào — phải thấy ngay, không thì lọt mất. */
  const withItems = new Set(rows.map((r) => r.findingId));
  const ncWithout = findings.filter((f) => needsCapa(f.severity) && !withItems.has(f.id));

  const unitGroups = useMemo(() => {
    const groups = [
      ...units.map((u) => ({ key: u.id, name: u.name })),
      ...(findings.some((f) => !f.unitId) ? [{ key: NO_UNIT, name: 'Chưa gán đơn vị' }] : []),
    ];
    return groups.map((g) => {
      const list = items.filter((i) => i.unitKey === g.key);
      const counts = Object.fromEntries(
        CAPA_STATUSES.map((s) => [s, list.filter((i) => i.status === s).length]),
      ) as Record<CapaStatus, number>;
      return {
        ...g,
        total: list.length,
        done: counts.DONE,
        counts,
        overdue: list.filter((i) => i.tone === 'overdue').length,
        missing: ncWithout.filter((f) => (f.unitId ?? NO_UNIT) === g.key).length,
      };
    });
  }, [units, findings, items, ncWithout]);

  /* ---------------- Lọc & sắp xếp ---------------- */

  const filtered = useMemo(() => {
    const toneRank: Record<DueTone, number> = { overdue: 0, soon: 1, ok: 2, none: 3, done: 4 };
    return items
      .filter(
        (i) =>
          (!filters.unit || i.unitKey === filters.unit) &&
          (!filters.severity || i.finding.severity === filters.severity) &&
          (!filters.status || i.status === filters.status) &&
          (!filters.due || i.tone === filters.due),
      )
      .sort(
        (a, b) =>
          toneRank[a.tone] - toneRank[b.tone] ||
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          (a.finding.code ?? '').localeCompare(b.finding.code ?? '', 'vi', { numeric: true }),
      );
  }, [items, filters]);

  const hasFilter = Object.values(filters).some(Boolean);

  /** Bấm một con số ở dải tổng quan: lọc theo nó, giữ nguyên đơn vị đang chọn. Bấm lại thì bỏ. */
  function toggleFilter<K extends 'status' | 'due'>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? '' : value }));
  }

  /* ---------------- Lưu ---------------- */

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Không lưu được.');
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const replaceRow = (row: CapaRow) => setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));

  async function quickStatus(id: string, status: CapaStatus) {
    const data = await call(`/api/audits/${auditId}/khac-phuc/${id}`, 'PATCH', { status });
    if (data?.item) replaceRow(data.item);
  }

  async function quickCreate() {
    const data = await call(`/api/audits/${auditId}/khac-phuc/tao-nhanh`, 'POST');
    if (data?.items) setRows((prev) => [...prev, ...data.items]);
  }

  async function saveDraft(draft: Draft): Promise<boolean> {
    const body = {
      content: draft.content,
      dueDate: draft.dueDate || null,
      status: draft.status,
      completedDate: draft.status === 'DONE' ? draft.completedDate || null : null,
      note: draft.note.trim() || null,
    };
    if (editing?.mode === 'edit') {
      const data = await call(`/api/audits/${auditId}/khac-phuc/${editing.id}`, 'PATCH', body);
      if (!data?.item) return false;
      replaceRow(data.item);
    } else {
      const data = await call(`/api/audits/${auditId}/khac-phuc`, 'POST', { findingId: draft.findingId, ...body });
      if (!data?.item) return false;
      setRows((prev) => [...prev, data.item]);
    }
    return true;
  }

  async function remove(id: string) {
    const data = await call(`/api/audits/${auditId}/khac-phuc/${id}`, 'DELETE');
    if (!data) return false;
    setRows((prev) => prev.filter((r) => r.id !== id));
    return true;
  }

  /* ---------------- Giao diện ---------------- */

  if (findings.length === 0) {
    return (
      <div className="card p-7 text-sm text-slate-500 sm:p-8">
        Đợt chưa có finding nào cần khắc phục. Khi có sự không phù hợp, quan sát hoặc cơ hội cải
        tiến, bạn lập kế hoạch khắc phục ở đây.
      </div>
    );
  }

  const editingRow = editing?.mode === 'edit' ? items.find((i) => i.id === editing.id) : undefined;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      {/* ============ Tổng quan: một dải mỏng ============ */}
      <section className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-semibold tabular-nums text-ink">{percent(done, total)}%</span>
          <span className="text-sm text-slate-500">
            hoàn thành · {done}/{total} mục
          </span>
        </div>

        <div className="min-w-[12rem] flex-1">
          <StackedBar counts={byStatus} total={total} className="h-2" />
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            {CAPA_STATUSES.map((s) => (
              <li key={s}>
                <button
                  onClick={() => toggleFilter('status', s)}
                  className={`flex items-center gap-1.5 rounded-full px-1.5 py-0.5 hover:text-ink ${
                    filters.status === s ? 'bg-slate-100 font-medium text-ink' : ''
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${CAPA_BAR[s]}`} />
                  {CAPA_LABEL[s]} <strong className="tabular-nums text-ink">{byStatus[s]}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-2">
          <AlertPill
            label="Trễ hạn"
            value={overdue}
            active={filters.due === 'overdue'}
            tone="red"
            onClick={() => toggleFilter('due', 'overdue')}
          />
          <AlertPill
            label="Sắp đến hạn"
            value={soon}
            active={filters.due === 'soon'}
            tone="amber"
            onClick={() => toggleFilter('due', 'soon')}
          />
        </div>
      </section>

      {ncWithout.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <span>
            <strong>{ncWithout.length}</strong> sự không phù hợp (Major / Minor NC) chưa có mục khắc phục:{' '}
            {ncWithout.map((f) => f.code).join(', ')}.
          </span>
          <button onClick={quickCreate} disabled={busy} className="btn-primary ml-auto !px-4 !py-1.5 text-sm">
            Tạo nhanh {ncWithout.length} mục
          </button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* ============ Đơn vị: vừa là số liệu, vừa là bộ lọc ============ */}
        <aside className="lg:sticky lg:top-20">
          {/* Điện thoại: một hàng nút trượt ngang */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
            <UnitPill name="Tất cả" pct={percent(done, total)} active={!filters.unit} onClick={() => setFilters((f) => ({ ...f, unit: '' }))} />
            {unitGroups.map((g) => (
              <UnitPill
                key={g.key}
                name={g.name}
                pct={g.total ? percent(g.done, g.total) : null}
                alert={g.overdue > 0}
                active={filters.unit === g.key}
                onClick={() => setFilters((f) => ({ ...f, unit: f.unit === g.key ? '' : g.key }))}
              />
            ))}
          </div>

          {/* Màn hình rộng: cột danh sách đơn vị */}
          <nav className="card hidden max-h-[calc(100vh-7rem)] overflow-y-auto p-2 lg:block">
            <p className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">Tiến độ theo đơn vị</p>
            <UnitRow
              name="Tất cả đơn vị"
              total={total}
              done={done}
              counts={byStatus}
              overdue={overdue}
              missing={ncWithout.length}
              active={!filters.unit}
              onClick={() => setFilters((f) => ({ ...f, unit: '' }))}
            />
            <div className="my-1 border-t border-slate-100" />
            {unitGroups.map((g) => (
              <UnitRow
                key={g.key}
                name={g.name}
                total={g.total}
                done={g.done}
                counts={g.counts}
                overdue={g.overdue}
                missing={g.missing}
                active={filters.unit === g.key}
                onClick={() => setFilters((f) => ({ ...f, unit: f.unit === g.key ? '' : g.key }))}
              />
            ))}
          </nav>
        </aside>

        {/* ============ Danh sách mục ============ */}
        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <h2 className="mr-auto text-lg font-semibold">
              {filters.unit ? unitGroups.find((g) => g.key === filters.unit)?.name : 'Tất cả các mục khắc phục'}
            </h2>
            <button onClick={() => setEditing({ mode: 'new' })} className="btn-primary">
              + Thêm mục khắc phục
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Phân loại"
              value={filters.severity}
              onChange={(v) => setFilters((f) => ({ ...f, severity: v }))}
              options={SEVERITY_ORDER.map((s) => ({ id: s, label: SEVERITY_LABELS[s] }))}
            />
            <FilterSelect
              label="Trạng thái"
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              options={CAPA_STATUSES.map((s) => ({ id: s, label: CAPA_LABEL[s] }))}
            />
            <FilterSelect
              label="Thời hạn"
              value={filters.due}
              onChange={(v) => setFilters((f) => ({ ...f, due: v as Filters['due'] }))}
              options={[
                { id: 'overdue', label: 'Trễ hạn' },
                { id: 'soon', label: 'Sắp đến hạn (7 ngày)' },
              ]}
            />
            {hasFilter && (
              <button onClick={() => setFilters(NO_FILTER)} className="btn-ghost">
                Bỏ lọc
              </button>
            )}
            <span className="ml-auto pb-2 text-sm text-slate-500">
              {hasFilter ? `${filtered.length} / ${total} mục` : `${total} mục`}
            </span>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="text-left text-xs font-semibold text-slate-500">
                <tr className="border-b border-slate-300">
                  <th className="w-24 py-3.5 pl-5 pr-3">Finding</th>
                  {!filters.unit && <th className="w-36 px-3 py-3.5">Đơn vị</th>}
                  <th className="px-3 py-3.5">Nội dung công việc cần thực hiện</th>
                  <th className="w-32 px-3 py-3.5">Thời hạn</th>
                  <th className="w-40 py-3.5 pl-3 pr-5">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={filters.unit ? 4 : 5} className="px-6 py-10 text-center text-sm text-slate-400">
                      {total === 0
                        ? 'Chưa có mục khắc phục nào. Bấm "+ Thêm mục khắc phục" để bắt đầu.'
                        : 'Không có mục nào khớp bộ lọc.'}
                    </td>
                  </tr>
                )}
                {filtered.map((i: Item) => (
                  <tr
                    key={i.id}
                    onClick={() => setEditing({ mode: 'edit', id: i.id })}
                    className={`cursor-pointer border-b border-slate-200 align-top last:border-b-0 hover:bg-frost ${
                      i.tone === 'overdue' ? 'bg-red-50/40' : ''
                    }`}
                  >
                    <td className="py-3.5 pl-5 pr-3">
                      <span className="font-mono text-xs text-slate-600">{i.finding.code}</span>
                      <div className="mt-1.5">
                        <SeverityBadge value={i.finding.severity} short />
                      </div>
                    </td>
                    {!filters.unit && <td className="px-3 py-3.5 text-slate-700">{i.finding.unitName}</td>}
                    <td className="px-3 py-3.5">
                      <p className="line-clamp-3 whitespace-pre-line text-ink">{i.content}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">Finding: {i.finding.title}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="tabular-nums text-slate-700">{formatDay(i.dueDate)}</span>
                      <div className="mt-1">
                        <DueChip tone={i.tone} dueDate={i.dueDate} completedDate={i.completedDate} today={today} />
                      </div>
                    </td>
                    <td className="py-3.5 pl-3 pr-5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={i.status}
                        disabled={busy}
                        onChange={(e) => quickStatus(i.id, e.target.value as CapaStatus)}
                        className={`w-full cursor-pointer rounded-full border-0 px-3 py-1.5 text-xs font-medium ${CAPA_STYLE[i.status]}`}
                      >
                        {CAPA_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {CAPA_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editing && (
        <CapaDrawer
          key={editing.mode === 'edit' ? editing.id : 'new'}
          mode={editing.mode}
          row={editingRow}
          findings={findings}
          unitOrder={unitGroups.map((g) => g.key)}
          presetFindingId={editing.mode === 'new' ? editing.findingId : undefined}
          busy={busy}
          error={error}
          today={today}
          onClose={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={async (d) => {
            if (await saveDraft(d)) setEditing(null);
          }}
          onDelete={
            editing.mode === 'edit'
              ? async () => {
                  if (await remove(editing.id)) setEditing(null);
                }
              : undefined
          }
          onAddAnother={(findingId) => setEditing({ mode: 'new', findingId })}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AlertPill({
  label, value, active, tone, onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  tone: 'red' | 'amber';
  onClick: () => void;
}) {
  const on = value > 0;
  const color = !on
    ? 'bg-slate-50 text-slate-400'
    : tone === 'red'
      ? 'bg-red-50 text-red-700'
      : 'bg-amber-50 text-amber-800';
  const ring = active ? (tone === 'red' ? 'ring-2 ring-red-400' : 'ring-2 ring-amber-400') : '';
  return (
    <button
      onClick={onClick}
      disabled={!on && !active}
      className={`flex items-baseline gap-2 rounded-xl px-4 py-2 text-left ${color} ${ring}`}
      title={active ? 'Bấm để bỏ lọc' : `Lọc các mục ${label.toLowerCase()}`}
    >
      <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

/** Một dòng đơn vị ở cột bên trái: tên, %, thanh tình trạng, cảnh báo. */
function UnitRow({
  name, total, done, counts, overdue, missing, active, onClick,
}: {
  name: string;
  total: number;
  done: number;
  counts: Record<CapaStatus, number>;
  overdue: number;
  missing: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-frost'
      }`}
    >
      <span className="flex items-baseline gap-2">
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? 'font-semibold text-brand-800' : 'font-medium text-ink'}`} title={name}>
          {name}
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            total === 0 ? 'text-slate-300' : done === total ? 'text-emerald-700' : 'text-ink'
          }`}
        >
          {total === 0 ? '—' : `${percent(done, total)}%`}
        </span>
      </span>
      {total > 0 && <StackedBar counts={counts} total={total} className="mt-1.5 h-1.5" />}
      <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
        <span>{total > 0 ? `${done}/${total} mục` : 'Chưa có mục'}</span>
        {overdue > 0 && <span className="font-medium text-red-600">Trễ {overdue}</span>}
        {missing > 0 && <span className="font-medium text-amber-700">{missing} NC chưa có mục</span>}
      </span>
    </button>
  );
}

/** Nút đơn vị dạng viên, dùng trên điện thoại. */
function UnitPill({
  name, pct, active, alert, onClick,
}: {
  name: string;
  pct: number | null;
  active: boolean;
  alert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
        active ? 'border-brand-600 bg-brand-50 font-medium text-brand-800' : 'border-slate-200 bg-white text-slate-700'
      }`}
    >
      {alert && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
      <span className="max-w-[10rem] truncate">{name}</span>
      <span className="tabular-nums text-slate-500">{pct === null ? '—' : `${pct}%`}</span>
    </button>
  );
}

/** Thanh tiến độ xếp chồng theo trạng thái, thứ tự Hoàn thành → … → Chưa thực hiện. */
function StackedBar({
  counts, total, className = '',
}: {
  counts: Record<CapaStatus, number>;
  total: number;
  className?: string;
}) {
  const order: CapaStatus[] = ['DONE', 'PENDING_REVIEW', 'IN_PROGRESS', 'TODO'];
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${className}`}
      title={order.map((s) => `${CAPA_LABEL[s]}: ${counts[s]}`).join(' · ')}
    >
      {total > 0 &&
        order.map((s) =>
          counts[s] > 0 ? (
            <span key={s} className={CAPA_BAR[s]} style={{ width: `${(counts[s] * 100) / total}%` }} />
          ) : null,
        )}
    </div>
  );
}

function DueChip({
  tone, dueDate, completedDate, today,
}: {
  tone: DueTone;
  dueDate: string | null;
  completedDate: string | null;
  today: string;
}) {
  if (tone === 'done') {
    const late = dueDate && completedDate && completedDate > dueDate;
    return (
      <span className={`chip ${late ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
        Xong {completedDate ? formatDay(completedDate).slice(0, 5) : ''}
        {late ? ' · trễ' : ''}
      </span>
    );
  }
  if (tone === 'none') return <span className="chip bg-slate-100 text-slate-500">Chưa có hạn</span>;
  const d = daysUntil(dueDate!, today);
  if (tone === 'overdue') return <span className="chip bg-red-100 text-red-700">Trễ {-d} ngày</span>;
  if (tone === 'soon') {
    return <span className="chip bg-amber-100 text-amber-800">{d === 0 ? 'Đến hạn hôm nay' : `Còn ${d} ngày`}</span>;
  }
  return <span className="chip bg-slate-100 text-slate-600">Còn {d} ngày</span>;
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input !w-auto min-w-[10rem] !py-2 ${value ? '!border-brand-600' : ''}`}
      >
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Khung chi tiết                                                      */
/* ------------------------------------------------------------------ */

type Draft = {
  findingId: string;
  content: string;
  dueDate: string;
  status: CapaStatus;
  completedDate: string;
  note: string;
};

/** "ISO 9001 — 7.5.3, 8.5.1" — điều khoản gom theo tiêu chuẩn. */
function clauseLines(clauses: CapaFinding['clauses']) {
  const byStd = new Map<string, string[]>();
  for (const c of clauses) byStd.set(c.standard, [...(byStd.get(c.standard) ?? []), c.clause]);
  return [...byStd].map(([std, list]) => `${STANDARD_SHORT[std as StandardCode] ?? std} — ${list.join(', ')}`);
}

/**
 * Khung bên phải để thêm hoặc sửa một mục. Phía trên là finding gốc (chỉ đọc)
 * để người nhập luôn thấy mình đang khắc phục cái gì.
 */
function CapaDrawer({
  mode, row, findings, unitOrder, presetFindingId, busy, error, today, onClose, onSave, onDelete, onAddAnother,
}: {
  mode: 'new' | 'edit';
  row?: CapaRow;
  findings: CapaFinding[];
  unitOrder: string[];
  presetFindingId?: string;
  busy: boolean;
  error: string | null;
  today: string;
  onClose: () => void;
  onSave: (d: Draft) => void;
  onDelete?: () => void;
  onAddAnother: (findingId: string) => void;
}) {
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const initialFinding = row ? findingById.get(row.findingId) : presetFindingId ? findingById.get(presetFindingId) : undefined;

  const [d, setD] = useState<Draft>(() => ({
    findingId: row?.findingId ?? initialFinding?.id ?? '',
    content: row?.content ?? '',
    dueDate: row?.dueDate ?? initialFinding?.dueDate ?? '',
    status: row?.status ?? 'TODO',
    completedDate: row?.completedDate ?? '',
    note: row?.note ?? '',
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const finding = findingById.get(d.findingId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Finding chọn được, gom theo đơn vị và theo thứ tự đơn vị của bảng trên. */
  const grouped = unitOrder
    .map((key) => ({
      key,
      list: findings
        .filter((f) => (f.unitId ?? '__none__') === key)
        .sort(
          (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
            (a.code ?? '').localeCompare(b.code ?? '', 'vi', { numeric: true }),
        ),
    }))
    .filter((g) => g.list.length > 0);

  const canSave = Boolean(d.findingId && d.content.trim()) && !busy;

  // Gắn thẳng vào <body>: khung bao của trang có hiệu ứng chuyển cảnh, nếu để
  // bên trong thì `fixed` bị neo theo khung đó và thanh menu đè lên trên.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold">{mode === 'new' ? 'Thêm mục khắc phục' : 'Chi tiết mục khắc phục'}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-ink" aria-label="Đóng">
            ×
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Finding gốc */}
          {mode === 'new' && (
            <div>
              <label className="label">
                Finding cần khắc phục<span className="ml-0.5 text-red-600">*</span>
              </label>
              <select
                value={d.findingId}
                onChange={(e) => {
                  const f = findingById.get(e.target.value);
                  setD((p) => ({ ...p, findingId: e.target.value, dueDate: p.dueDate || f?.dueDate || '' }));
                }}
                className="input"
              >
                <option value="">— Chọn finding —</option>
                {grouped.map((g) => (
                  <optgroup key={g.key} label={g.list[0].unitName}>
                    {g.list.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {SEVERITY_LABELS[f.severity]?.replace(/ \(.*\)$/, '')} — {f.title.slice(0, 80)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {finding && (
            <div className="rounded-xl bg-mist p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-600">{finding.code}</span>
                <SeverityBadge value={finding.severity} />
                <span className="text-xs text-slate-500">· {finding.unitName}</span>
              </div>
              <p className="mt-2 font-medium text-ink">{finding.title}</p>
              {finding.statement && (
                <p className="mt-1.5 line-clamp-6 whitespace-pre-line text-slate-600">{finding.statement}</p>
              )}
              {finding.clauses.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">{clauseLines(finding.clauses).join(' · ')}</p>
              )}
            </div>
          )}

          <div>
            <label className="label">
              Nội dung công việc cần thực hiện<span className="ml-0.5 text-red-600">*</span>
            </label>
            <textarea
              rows={4}
              value={d.content}
              onChange={(e) => set('content', e.target.value)}
              placeholder="Ví dụ: Rà soát và ban hành lại quy trình kiểm soát hồ sơ; đào tạo lại nhân viên kho."
              className="input"
            />
          </div>

          <div>
            <label className="label">Thời hạn</label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="date"
                value={d.dueDate}
                onChange={(e) => set('dueDate', e.target.value)}
                className="input !w-auto"
              />
              {finding?.dueDate && finding.dueDate !== d.dueDate && (
                <button
                  type="button"
                  onClick={() => set('dueDate', finding.dueDate!)}
                  className="text-xs text-brand-700 hover:underline"
                >
                  Dùng hạn gợi ý của finding ({formatDay(finding.dueDate)})
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Thời hạn riêng của mục này — sửa ở đây không đổi các mục khác. Hạn 30 ngày (Major) /
              60 ngày (Minor) chỉ là gợi ý lúc tạo.
            </p>
          </div>

          <div>
            <label className="label">Trạng thái</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CAPA_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setD((p) => ({ ...p, status: s, completedDate: s === 'DONE' ? p.completedDate || today : '' }))
                  }
                  className={`rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                    d.status === s ? `${CAPA_STYLE[s]} border-current` : 'border-slate-200 text-slate-600 hover:bg-frost'
                  }`}
                >
                  {CAPA_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {d.status === 'DONE' && (
            <div className="sm:w-1/2">
              <label className="label">Ngày hoàn thành</label>
              <input
                type="date"
                value={d.completedDate}
                onChange={(e) => set('completedDate', e.target.value)}
                className="input"
              />
            </div>
          )}

          <div>
            <label className="label">Kết quả kiểm tra / Ghi chú</label>
            <textarea
              rows={3}
              value={d.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Bằng chứng đã xem, đánh giá hiệu lực, lý do gia hạn…"
              className="input"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-6 py-4">
          <button onClick={() => onSave(d)} disabled={!canSave} className="btn-primary">
            {busy ? 'Đang lưu…' : mode === 'new' ? 'Thêm mục' : 'Lưu thay đổi'}
          </button>
          <button onClick={onClose} className="btn-ghost">
            Huỷ
          </button>
          {mode === 'edit' && row && (
            <button onClick={() => onAddAnother(row.findingId)} className="text-sm text-brand-700 hover:underline">
              + Thêm mục khác cho finding này
            </button>
          )}
          {onDelete && (
            <span className="ml-auto">
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">Xoá mục này?</span>
                  <button onClick={onDelete} disabled={busy} className="font-medium text-red-600 hover:underline">
                    Xoá
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="text-slate-500 hover:underline">
                    Không
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-600 hover:underline">
                  Xoá mục
                </button>
              )}
            </span>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
