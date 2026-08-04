'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildShortNames } from '@/lib/utils';
import {
  HALF_LABELS, KIND_LABELS, findConflicts, formatDayLong, generateDraftPlan, listSlots,
  type Half, type PlanSession, type SessionKind,
} from '@/lib/plan';

type Unit = { id: string; name: string; contactPerson: string | null };
type Member = { id: string; fullName: string };

type PlanInfo = {
  objectives: string;
  criteria: string;
  location: string;
  approverTitle: string;
  approverName: string;
  amStart: string;
  amEnd: string;
  pmStart: string;
  pmEnd: string;
};

/**
 * Lập chương trình đánh giá.
 *
 * Một phiên = một buổi. Trong cùng buổi có thể có nhiều đơn vị song song, miễn
 * do các đánh giá viên khác nhau phụ trách. Danh sách người tham gia KHÔNG nhập
 * tay — suy ra từ ma trận phân công ở bước chuẩn bị, nên sửa phân công là lịch
 * tự đúng theo.
 *
 * Mọi thay đổi giữ ở trình duyệt cho tới khi bấm Lưu, giống ma trận phân công.
 */
export function AuditPlan({
  auditId, days, units, members, assignments, initialInfo, initialSessions, locked,
}: {
  auditId: string;
  days: string[];
  units: Unit[];
  members: Member[];
  /** Cặp "memberId:unitId" đã phân công. */
  assignments: string[];
  initialInfo: PlanInfo;
  initialSessions: PlanSession[];
  locked: boolean;
}) {
  const router = useRouter();

  const [info, setInfo] = useState<PlanInfo>(initialInfo);
  const [contacts, setContacts] = useState<Record<string, string>>(
    Object.fromEntries(units.map((u) => [u.id, u.contactPerson ?? ''])),
  );
  const [sessions, setSessions] = useState<PlanSession[]>(initialSessions);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const slots = useMemo(() => listSlots(days), [days]);
  const shortNames = useMemo(() => buildShortNames(members.map((m) => m.fullName)), [members]);

  /** Đơn vị → danh sách đánh giá viên phụ trách. */
  const unitMembers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pair of assignments) {
      const [memberId, unitId] = pair.split(':');
      map.set(unitId, [...(map.get(unitId) ?? []), memberId]);
    }
    return map;
  }, [assignments]);

  const conflicts = useMemo(() => findConflicts(sessions, unitMembers), [sessions, unitMembers]);

  const scheduledUnitIds = useMemo(
    () => new Set(sessions.filter((s) => s.kind === 'UNIT' && s.unitId).map((s) => s.unitId!)),
    [sessions],
  );
  const unscheduled = units.filter((u) => !scheduledUnitIds.has(u.id));

  /* ---------------- Thao tác trên lịch ---------------- */

  function moveSession(sessionId: string, day: string, half: Half) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, day, half } : s)));
  }

  function removeSession(sessionId: string) {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }

  function addSession(day: string, half: Half, kind: SessionKind, unitId: string | null) {
    setSessions((prev) => [
      ...prev,
      { id: `tam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, day, half, kind, unitId, note: null },
    ]);
  }

  function autoGenerate() {
    if (
      sessions.length > 0 &&
      !confirm('Sinh lại lịch nháp sẽ thay thế toàn bộ lịch hiện tại. Tiếp tục?')
    ) {
      return;
    }
    const draft = generateDraftPlan({ days, units, unitMembers });
    setSessions(
      draft.map((s, i) => ({ ...s, id: `tam-${i}-${Math.random().toString(36).slice(2, 7)}` })),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/chuong-trinh`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...info,
          contacts: units.map((u) => ({ unitId: u.id, contactPerson: contacts[u.id] ?? '' })),
          sessions: sessions.map(({ day, half, kind, unitId, note }) => ({
            day, half, kind, unitId, note,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Lưu thất bại.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setBusy(false);
    }
  }

  const unitById = new Map(units.map((u) => [u.id, u]));

  if (days.length === 0) {
    return (
      <p className="card p-6 text-sm text-slate-500">
        Đợt chưa có khoảng thời gian. Quay lại bước tạo đợt để nhập ngày bắt đầu và kết thúc.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      {/* ============ Thông tin chương trình ============ */}
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Thông tin chương trình</h2>

        <Field label="Mục tiêu đánh giá">
          <textarea
            rows={4}
            className="input"
            disabled={locked}
            value={info.objectives}
            onChange={(e) => setInfo((v) => ({ ...v, objectives: e.target.value }))}
          />
        </Field>

        <Field label="Chuẩn mực đánh giá">
          <textarea
            rows={4}
            className="input"
            disabled={locked}
            value={info.criteria}
            onChange={(e) => setInfo((v) => ({ ...v, criteria: e.target.value }))}
          />
        </Field>

        <Field label="Địa điểm đánh giá">
          <input
            className="input"
            disabled={locked}
            value={info.location}
            onChange={(e) => setInfo((v) => ({ ...v, location: e.target.value }))}
          />
        </Field>

        <div>
          <label className="label">Giờ làm việc</label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-14 text-slate-500">Sáng</span>
            <TimeInput
              value={info.amStart}
              disabled={locked}
              onChange={(v) => setInfo((s) => ({ ...s, amStart: v }))}
            />
            <span className="text-slate-400">–</span>
            <TimeInput
              value={info.amEnd}
              disabled={locked}
              onChange={(v) => setInfo((s) => ({ ...s, amEnd: v }))}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="w-14 text-slate-500">Chiều</span>
            <TimeInput
              value={info.pmStart}
              disabled={locked}
              onChange={(v) => setInfo((s) => ({ ...s, pmStart: v }))}
            />
            <span className="text-slate-400">–</span>
            <TimeInput
              value={info.pmEnd}
              disabled={locked}
              onChange={(v) => setInfo((s) => ({ ...s, pmEnd: v }))}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Chức danh người phê duyệt">
            <input
              className="input"
              disabled={locked}
              placeholder="GIÁM ĐỐC XÍ NGHIỆP"
              value={info.approverTitle}
              onChange={(e) => setInfo((v) => ({ ...v, approverTitle: e.target.value }))}
            />
          </Field>
          <Field label="Họ tên người phê duyệt">
            <input
              className="input"
              disabled={locked}
              value={info.approverName}
              onChange={(e) => setInfo((v) => ({ ...v, approverName: e.target.value }))}
            />
          </Field>
        </div>
      </section>

      {/* ============ Đại diện đơn vị ============ */}
      <section className="card p-5">
        <h2 className="mb-4 font-semibold">Đại diện đơn vị</h2>
        {units.length === 0 ? (
          <p className="text-sm text-slate-400">Chưa khai báo đơn vị nào ở bước chuẩn bị.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {units.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium">{u.name}</span>
                <input
                  className="input sm:w-64"
                  disabled={locked}
                  placeholder="Họ tên người đại diện"
                  value={contacts[u.id] ?? ''}
                  onChange={(e) => setContacts((c) => ({ ...c, [u.id]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ============ Lịch đánh giá ============ */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Lịch đánh giá</h2>
          {!locked && (
            <button onClick={autoGenerate} className="btn-ghost !py-1.5 text-sm">
              Sinh lịch nháp tự động
            </button>
          )}
          {conflicts.size > 0 && (
            <span className="chip bg-red-100 text-red-800 ring-transparent">
              {conflicts.size} xung đột lịch
            </span>
          )}
        </div>

        {unscheduled.length > 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Chưa xếp lịch cho: <strong>{unscheduled.map((u) => u.name).join(', ')}</strong>
          </p>
        )}

        <div className="space-y-4">
          {days.map((day, dayIndex) => (
            <div key={day} className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium">
                Ngày {dayIndex + 1} — {formatDayLong(day)}
              </p>

              <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
                {(['AM', 'PM'] as Half[]).map((half) => {
                  const inSlot = sessions.filter((s) => s.day === day && s.half === half);
                  const hours =
                    half === 'AM' ? `${info.amStart}–${info.amEnd}` : `${info.pmStart}–${info.pmEnd}`;

                  return (
                    <div key={half} className="bg-white p-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {HALF_LABELS[half]} · {hours}
                      </p>

                      <ul className="space-y-1.5">
                        {inSlot.map((s) => {
                          const unit = s.unitId ? unitById.get(s.unitId) : null;
                          const memberIds = s.unitId ? unitMembers.get(s.unitId) ?? [] : [];
                          const hasConflict = memberIds.some((m) =>
                            conflicts.has(`${day}|${half}|${m}`),
                          );

                          return (
                            <li
                              key={s.id}
                              className={`rounded-md border px-2.5 py-2 text-sm ${
                                hasConflict
                                  ? 'border-red-300 bg-red-50'
                                  : s.kind === 'UNIT'
                                    ? 'border-slate-200'
                                    : 'border-slate-200 bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium">
                                    {s.kind === 'UNIT' ? unit?.name ?? '(đơn vị đã xoá)' : KIND_LABELS[s.kind]}
                                  </span>
                                  {s.kind === 'UNIT' && (
                                    <span className="mt-0.5 block text-xs text-slate-500">
                                      {memberIds.length === 0
                                        ? 'Chưa phân công đánh giá viên'
                                        : memberIds
                                            .map((m) => {
                                              const i = members.findIndex((x) => x.id === m);
                                              return i >= 0 ? shortNames[i] : '?';
                                            })
                                            .join(' · ')}
                                    </span>
                                  )}
                                </span>

                                {!locked && (
                                  <button
                                    onClick={() => removeSession(s.id)}
                                    className="shrink-0 text-xs text-red-600 hover:underline"
                                  >
                                    Bỏ
                                  </button>
                                )}
                              </div>

                              {!locked && slots.length > 1 && (
                                <select
                                  value={`${s.day}|${s.half}`}
                                  onChange={(e) => {
                                    const [d, h] = e.target.value.split('|');
                                    moveSession(s.id, d, h as Half);
                                  }}
                                  className="mt-1.5 w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                                >
                                  {slots.map((sl, i) => (
                                    <option key={i} value={`${sl.day}|${sl.half}`}>
                                      Chuyển tới: Ngày {days.indexOf(sl.day) + 1} — {HALF_LABELS[sl.half]}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </li>
                          );
                        })}

                        {inSlot.length === 0 && (
                          <li className="py-2 text-xs text-slate-400">Chưa có gì</li>
                        )}
                      </ul>

                      {!locked && (
                        <AddToSlot
                          units={units}
                          onAdd={(kind, unitId) => addSession(day, half, kind, unitId)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {!locked && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu chương trình'}
          </button>
          <a href={`/api/audits/${auditId}/xuat-word`} className="btn-ghost">
            Xuất file Word
          </a>
          <span className="text-xs text-slate-400">Lưu trước khi xuất file để lấy bản mới nhất</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AddToSlot({
  units, onAdd,
}: {
  units: Unit[];
  onAdd: (kind: SessionKind, unitId: string | null) => void;
}) {
  const [value, setValue] = useState('');

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        if (v.startsWith('unit:')) onAdd('UNIT', v.slice(5));
        else onAdd(v as SessionKind, null);
        setValue('');
      }}
      className="mt-2 w-full rounded border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500"
    >
      <option value="">+ Thêm vào buổi này…</option>
      <optgroup label="Đơn vị">
        {units.map((u) => (
          <option key={u.id} value={`unit:${u.id}`}>{u.name}</option>
        ))}
      </optgroup>
      <optgroup label="Khác">
        <option value="OPENING">{KIND_LABELS.OPENING}</option>
        <option value="INTERNAL">{KIND_LABELS.INTERNAL}</option>
        <option value="CLOSING">{KIND_LABELS.CLOSING}</option>
      </optgroup>
    </select>
  );
}

function TimeInput({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <input
      type="time"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
    />
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
