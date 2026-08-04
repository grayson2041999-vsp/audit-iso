'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildShortNames } from '@/lib/utils';
import { PlanCalculator } from './PlanCalculator';
import { ScheduleGrid } from './ScheduleGrid';
import {
  KIND_LABELS, checkWorkingHours, durationLabel, findTimeConflicts,
  generateTimedPlan, toHHMM, toMinutes,
  type Hours, type PlanSession, type SessionKind,
} from '@/lib/plan';

type Unit = { id: string; name: string };
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
  openingMinutes: number;
  closingMinutes: number;
};

/**
 * Lập chương trình đánh giá.
 *
 * Mỗi phiên có giờ bắt đầu – kết thúc riêng, nhiều phiên chạy song song được.
 * Người tham gia KHÔNG nhập tay: phiên đơn vị lấy theo ma trận phân công ở bước
 * chuẩn bị, phiên họp thì cả đoàn. Sửa phân công là lịch tự đúng theo.
 *
 * Mọi thay đổi giữ ở trình duyệt cho tới khi bấm Lưu.
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
  const [genNote, setGenNote] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const shortNames = useMemo(() => buildShortNames(members.map((m) => m.fullName)), [members]);
  const allMemberIds = useMemo(() => members.map((m) => m.id), [members]);

  const unitMembers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pair of assignments) {
      const [memberId, unitId] = pair.split(':');
      map.set(unitId, [...(map.get(unitId) ?? []), memberId]);
    }
    return map;
  }, [assignments]);

  const build = (hours: Hours) =>
    generateTimedPlan({ days, hours, units, unitMembers, allMemberIds });

  /**
   * Chưa lưu lịch bao giờ thì tính sẵn ngay khi mở tab — không bắt bấm nút để
   * tạo ra thứ mà hệ thống đã tự suy ra được từ ngày, đơn vị và phân công.
   * Bản tính sẵn này CHƯA vào database, chỉ ghi khi bấm Lưu chương trình.
   */
  const [sessions, setSessions] = useState<PlanSession[]>(() => {
    if (initialSessions.length > 0) return initialSessions;
    return build(initialInfo).sessions.map((x, i) => ({
      ...x,
      id: `tam-${i}-${Math.random().toString(36).slice(2, 7)}`,
    }));
  });

  const neverSaved = initialSessions.length === 0;

  /**
   * Lịch đã lưu có còn khớp dữ liệu gốc không. Thêm đơn vị sau khi lưu lịch mà
   * app im lặng thì tới lúc xuất Word mới phát hiện thiếu.
   */
  const drift = useMemo(() => {
    if (neverSaved) return null;
    const inPlan = new Set(
      initialSessions.filter((x) => x.kind === 'UNIT' && x.unitId).map((x) => x.unitId!),
    );
    const added = units.filter((u) => !inPlan.has(u.id));
    const known = new Set(units.map((u) => u.id));
    const removed = [...inPlan].filter((id) => !known.has(id));

    if (added.length === 0 && removed.length === 0) return null;
    const parts: string[] = [];
    if (added.length) parts.push(`đã thêm ${added.length} đơn vị (${added.map((u) => u.name).join(', ')})`);
    if (removed.length) parts.push(`${removed.length} đơn vị trong lịch đã bị xoá`);
    return `Sau khi lưu lịch, ${parts.join(' và ')}. Bấm Tính lại lịch để cập nhật.`;
  }, [neverSaved, initialSessions, units]);

  const conflicts = useMemo(
    () => findTimeConflicts(sessions, unitMembers, members),
    [sessions, unitMembers, members],
  );

  /** Số đơn vị mà đánh giá viên bận nhất đang giữ, theo phân công thực tế. */
  const busiestRounds = useMemo(() => {
    const load = new Map<string, number>();
    for (const ms of unitMembers.values()) {
      for (const m of ms) load.set(m, (load.get(m) ?? 0) + 1);
    }
    return load.size === 0 ? 0 : Math.max(...load.values());
  }, [unitMembers]);

  const minutesPerDay =
    toMinutes(info.amEnd) - toMinutes(info.amStart) + (toMinutes(info.pmEnd) - toMinutes(info.pmStart));

  const scheduledUnitIds = useMemo(
    () => new Set(sessions.filter((s) => s.kind === 'UNIT' && s.unitId).map((s) => s.unitId!)),
    [sessions],
  );
  const unscheduled = units.filter((u) => !scheduledUnitIds.has(u.id));

  /** Lưới không đủ chỗ hiện chữ, nên gom lỗi giờ giấc thành danh sách bên dưới. */
  const hoursIssues = useMemo(() => {
    const out: string[] = [];
    for (const s of sessions) {
      const issue = checkWorkingHours(s, info);
      if (!issue) continue;
      const unit = units.find((u) => u.id === s.unitId);
      const what = s.kind === 'UNIT' ? unit?.name ?? 'Phiên' : KIND_LABELS[s.kind];
      out.push(`${what} ${s.startTime}–${s.endTime}: ${issue}`);
    }
    return out;
  }, [sessions, info, units]);

  const unitById = new Map(units.map((u) => [u.id, u]));
  const shortById = new Map(members.map((m, i) => [m.id, shortNames[i]]));

  /* ---------------- Thao tác ---------------- */

  function patchSession(id: string, patch: Partial<PlanSession>) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function addSession(day: string, kind: SessionKind, unitId: string | null) {
    // Nối tiếp phiên cuối cùng trong ngày, mặc định 90 phút.
    const sameDay = sessions.filter((s) => s.day === day);
    const lastEnd = sameDay.length
      ? sameDay.reduce((mx, s) => Math.max(mx, toMinutes(s.endTime)), 0)
      : toMinutes(info.amStart);
    const start = Math.min(lastEnd, toMinutes(info.pmEnd) - 90);
    const hh = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

    setSessions((prev) => [
      ...prev,
      {
        id: `tam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        day,
        startTime: hh(Math.max(0, start)),
        endTime: hh(Math.max(90, start + 90)),
        kind,
        unitId,
        note: null,
      },
    ]);
  }

  function autoGenerate() {
    if (
      sessions.length > 0 &&
      !confirm('Tính lại lịch sẽ thay thế toàn bộ lịch hiện tại, kể cả những chỗ bạn đã sửa tay. Tiếp tục?')
    ) {
      return;
    }
    const res = build(info);
    setSessions(
      res.sessions.map((x, i) => ({ ...x, id: `tam-${i}-${Math.random().toString(36).slice(2, 7)}` })),
    );

    const { capacity: c } = res;
    setGenNote(
      c.atFloor
        ? `Quỹ thời gian không đủ: ${c.unitCount} đơn vị trong ${c.dayCount} ngày. Cần thêm ngày đánh giá hoặc thêm đánh giá viên.`
        : c.mode === 'SEQUENTIAL'
          ? `Cả đoàn đi cùng nhau, mỗi đơn vị khoảng ${durationLabel('00:00', toHHMM(c.perUnitMinutes))}. Tick phân công ở bước Chuẩn bị để các đánh giá viên làm song song.`
          : `Xếp song song theo phân công, mỗi đơn vị khoảng ${durationLabel('00:00', toHHMM(c.perUnitMinutes))}.`,
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
          sessions: sessions.map(({ day, startTime, endTime, kind, unitId, note }) => ({
            day, startTime, endTime, kind, unitId, note,
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Chức danh người phê duyệt">
            <input
              // Tự in hoa để file Word luôn đều một dạng, không phụ thuộc người nhập.
              className="input uppercase"
              disabled={locked}
              placeholder="GIÁM ĐỐC XÍ NGHIỆP"
              value={info.approverTitle}
              onChange={(e) =>
                setInfo((v) => ({ ...v, approverTitle: e.target.value.toLocaleUpperCase('vi') }))
              }
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

      {/* ============ Khung giờ làm việc ============ */}
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Khung giờ làm việc</h2>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-14 text-slate-500">Sáng</span>
          <TimeInput value={info.amStart} disabled={locked} onChange={(v) => setInfo((s) => ({ ...s, amStart: v }))} />
          <span className="text-slate-400">–</span>
          <TimeInput value={info.amEnd} disabled={locked} onChange={(v) => setInfo((s) => ({ ...s, amEnd: v }))} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-14 text-slate-500">Chiều</span>
          <TimeInput value={info.pmStart} disabled={locked} onChange={(v) => setInfo((s) => ({ ...s, pmStart: v }))} />
          <span className="text-slate-400">–</span>
          <TimeInput value={info.pmEnd} disabled={locked} onChange={(v) => setInfo((s) => ({ ...s, pmEnd: v }))} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Thời lượng họp khai mạc (phút)">
            <input
              type="number"
              min={15}
              step={15}
              className="input"
              disabled={locked}
              value={info.openingMinutes}
              onChange={(e) => setInfo((v) => ({ ...v, openingMinutes: Number(e.target.value) || 30 }))}
            />
          </Field>
          <Field label="Thời lượng họp kết thúc (phút)">
            <input
              type="number"
              min={15}
              step={15}
              className="input"
              disabled={locked}
              value={info.closingMinutes}
              onChange={(e) => setInfo((v) => ({ ...v, closingMinutes: Number(e.target.value) || 90 }))}
            />
          </Field>
        </div>
      </section>

      <PlanCalculator
        unitCount={units.length}
        actualDays={days.length}
        actualMembers={members.length}
        minutesPerDay={minutesPerDay}
        openingMinutes={info.openingMinutes}
        closingMinutes={info.closingMinutes}
        busiestRounds={busiestRounds}
      />

      {/* ============ Lịch đánh giá ============ */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Lịch đánh giá</h2>
          {!locked && (
            <button onClick={autoGenerate} className="btn-ghost !py-1.5 text-sm">
              Tính lại lịch
            </button>
          )}
          {neverSaved && (
            <span className="chip bg-slate-100 text-slate-600 ring-transparent">
              Bản tính sẵn — chưa lưu
            </span>
          )}
        </div>

        {drift && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{drift}</p>
        )}

        {genNote && (
          <p
            className={`mb-4 rounded-lg px-3 py-2.5 text-sm ${
              genNote.startsWith('Quỹ') ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'
            }`}
          >
            {genNote}
          </p>
        )}

        {conflicts.messages.length > 0 && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <p className="font-medium">Trùng lịch đánh giá viên:</p>
            <ul className="mt-1 space-y-0.5">
              {conflicts.messages.map((m, i) => (
                <li key={i}>• {m}</li>
              ))}
            </ul>
          </div>
        )}

        {unscheduled.length > 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Chưa xếp lịch cho: <strong>{unscheduled.map((u) => u.name).join(', ')}</strong>
          </p>
        )}

        <ScheduleGrid
          days={days}
          hours={info}
          sessions={sessions}
          units={units}
          members={members.map((m, i) => ({ ...m, short: shortNames[i] }))}
          unitMembers={unitMembers}
          conflictIds={conflicts.ids}
          locked={locked}
          onPatch={patchSession}
          onRemove={removeSession}
        />

        {!locked && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <AddSessionRow days={days} units={units} onAdd={addSession} />
          </div>
        )}

        {hoursIssues.length > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p className="font-medium">Phiên nằm ngoài giờ làm việc:</p>
            <ul className="mt-1 space-y-0.5">
              {hoursIssues.map((m, i) => (
                <li key={i}>• {m}</li>
              ))}
            </ul>
          </div>
        )}
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

function AddSessionRow({
  days, units, onAdd,
}: {
  days: string[];
  units: Unit[];
  onAdd: (day: string, kind: SessionKind, unitId: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [day, setDay] = useState(days[0] ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      >
        {days.map((d, i) => (
          <option key={d} value={d}>Ngày {i + 1}</option>
        ))}
      </select>

    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v || !day) return;
        if (v.startsWith('unit:')) onAdd(day, 'UNIT', v.slice(5));
        else onAdd(day, v as SessionKind, null);
        setValue('');
      }}
      className="flex-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-sm text-slate-500"
    >
      <option value="">+ Thêm phiên…</option>
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
    </div>
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
      step={900} // bước 15 phút
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
