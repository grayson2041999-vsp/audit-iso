'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WordIcon } from './FileIcons';
import {
  KIND_LABELS, dayEnd, dayStart, formatRanges, rangesProblem, sortRanges,
  formatDayLong, formatDayShort, pinMeetings, sortSessions, toHHMM,
  toMinutes, validatePlan,
  type AuditDay, type PlanSession, type SessionKind, type TimeRange,
} from '@/lib/plan';

type Unit = { id: string; name: string };
type Member = { id: string; fullName: string };

type PlanInfo = {
  objectives: string;
  criteria: string;
  location: string;
  approverTitle: string;
  approverName: string;
  /** Thời lượng mặc định của hai cuộc họp, dùng khi lịch chưa có chúng. */
  openingMinutes: number;
  closingMinutes: number;
};

const sortDays = (list: AuditDay[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));

const newId = () => `tam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const meetingLength = (list: PlanSession[], kind: SessionKind, fallback: number) => {
  const s = list.find((x) => x.kind === kind);
  return s ? Math.max(5, toMinutes(s.endTime) - toMinutes(s.startTime)) : fallback;
};

const isPinned = (s: PlanSession) => s.kind === 'OPENING' || s.kind === 'CLOSING';

/**
 * Lập chương trình đánh giá.
 *
 * Hai phần, đọc từ trên xuống như chính file Word:
 *  1. Giờ làm việc từng ngày — mỗi ngày một hoặc nhiều khoảng giờ. Danh sách
 *     ngày chọn ở tab Thiết lập đợt đánh giá, ở đây không thêm bớt được.
 *  2. Lịch từng ngày — bảng các phiên theo giờ. Đánh giá viên không nhập tay:
 *     phiên đơn vị lấy theo phân công, phiên họp thì cả đoàn.
 *
 * Họp khai mạc luôn ở đầu ngày đầu, họp kết thúc luôn ở cuối ngày cuối — app tự
 * ghim, kể cả khi sửa giờ của ngày. Mọi thay đổi giữ ở trình duyệt cho tới
 * khi bấm Lưu. Lỗi bắt buộc (tô đỏ) chặn lưu; trùng giờ (tô vàng) chỉ cảnh báo.
 */
export function AuditPlan({
  auditId, initialDays, units, members, assignments, initialInfo, initialSessions, locked,
}: {
  auditId: string;
  /** Ngày thực hiện đã lưu. Không cần liền nhau. */
  initialDays: AuditDay[];
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
  const [planDays, setPlanDays] = useState<AuditDay[]>(() => sortDays(initialDays));

  const unitMembers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pair of assignments) {
      const [memberId, unitId] = pair.split(':');
      map.set(unitId, [...(map.get(unitId) ?? []), memberId]);
    }
    return map;
  }, [assignments]);

  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.fullName])), [members]);

  const neverSaved = initialSessions.length === 0;

  /**
   * Chưa lưu lịch bao giờ thì các ngày để trống, trưởng đoàn tự thêm từng dòng.
   * Dù là lịch cũ hay mới, hai cuộc họp luôn được ghim vào đúng chỗ ngay từ đầu.
   */
  const [sessions, setSessions] = useState<PlanSession[]>(() =>
    pinMeetings(initialSessions, sortDays(initialDays), initialInfo, newId),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const check = useMemo(
    () => validatePlan({ days: planDays, sessions, units, unitMembers, members }),
    [planDays, sessions, units, unitMembers, members],
  );

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, PlanSession[]>();
    for (const s of sortSessions(sessions)) map.set(s.day, [...(map.get(s.day) ?? []), s]);
    return map;
  }, [sessions]);

  const scheduledUnits = useMemo(
    () => new Set(sessions.filter((s) => s.kind === 'UNIT' && s.unitId).map((s) => s.unitId!)),
    [sessions],
  );

  /**
   * Các ô bắt buộc của chương trình đánh giá — cả năm đều xuất thẳng ra Word:
   * thiếu mục tiêu và chuẩn mực thì không còn là chương trình theo ISO 19011,
   * thiếu người phê duyệt thì khối ký trống.
   */
  const REQUIRED: { key: keyof PlanInfo; label: string }[] = [
    { key: 'objectives', label: 'Mục tiêu đánh giá' },
    { key: 'criteria', label: 'Chuẩn mực đánh giá' },
    { key: 'location', label: 'Địa điểm đánh giá' },
    { key: 'approverTitle', label: 'Chức danh người phê duyệt' },
    { key: 'approverName', label: 'Họ tên người phê duyệt' },
  ];
  const missingFields = REQUIRED.filter((f) => !String(info[f.key] ?? '').trim());

  /** Ngày nào có khoảng giờ sai: kết thúc trước bắt đầu, hoặc hai khoảng chồng nhau. */
  const brokenDays = planDays
    .map((d, i) => ({ i, problem: rangesProblem(d.ranges) }))
    .filter((x) => x.problem)
    .map((x) => `ngày ${x.i + 1}: ${x.problem}`);

  /* ---------------- Hoàn tác ---------------- */

  /**
   * Lịch sử cho LỊCH và NGÀY, không cho các ô chữ — ô chữ đã có Ctrl+Z của
   * trình duyệt. Giữ trong ref: đẩy một bước không cần vẽ lại, chỉ hai nút
   * Hoàn tác / Làm lại cần biết nên mới có `tick`.
   */
  type Snap = { sessions: PlanSession[]; days: AuditDay[] };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const [tick, setTick] = useState(0);

  function undo() {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, { sessions, days: planDays }];
    setSessions(prev.sessions);
    setPlanDays(prev.days);
    setTick((t) => t + 1);
  }

  function redo() {
    const next = future.current[future.current.length - 1];
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, { sessions, days: planDays }];
    setSessions(next.sessions);
    setPlanDays(next.days);
    setTick((t) => t + 1);
  }

  useEffect(() => {
    if (locked) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey)) return;
      // Trong ô nhập thì để trình duyệt tự hoàn tác chữ.
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, select, textarea, [contenteditable]')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /**
   * Cửa duy nhất để đổi lịch hoặc ngày: ghi lịch sử, rồi ghim lại hai cuộc họp
   * theo danh sách ngày mới. Không thao tác nào đi vòng qua được bước ghim.
   */
  function apply(nextSessions: PlanSession[], nextDays: AuditDay[] = planDays) {
    if (locked) return;
    past.current = [...past.current, { sessions, days: planDays }].slice(-60);
    future.current = [];
    const days = sortDays(nextDays);
    const defaults = {
      openingMinutes: meetingLength(nextSessions, 'OPENING', info.openingMinutes),
      closingMinutes: meetingLength(nextSessions, 'CLOSING', info.closingMinutes),
    };
    setPlanDays(days);
    setSessions(pinMeetings(nextSessions, days, defaults, newId));
    setError(null);
    setTick((t) => t + 1);
  }

  /* ---------------- Giờ làm việc từng ngày ---------------- */

  const dates = planDays.map((d) => d.date);

  function setDayRanges(date: string, ranges: TimeRange[]) {
    apply(sessions, planDays.map((d) => (d.date === date ? { ...d, ranges } : d)));
  }

  function applyRangesToAll() {
    const first = planDays[0];
    if (!first) return;
    apply(sessions, planDays.map((d) => ({ ...d, ranges: first.ranges.map((r) => ({ ...r })) })));
  }

  /* ---------------- Dòng lịch ---------------- */

  function patchSession(id: string, patch: Partial<PlanSession>) {
    apply(sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSession(id: string) {
    apply(sessions.filter((s) => s.id !== id));
  }

  /**
   * Thêm một dòng vào ngày: nối tiếp sau phiên muộn nhất (trừ họp kết thúc),
   * nằm trong khoảng giờ còn chỗ, dài tối đa 1 giờ, và chọn sẵn đơn vị đầu tiên
   * chưa có lịch.
   */
  function addRow(date: string) {
    const day = planDays.find((d) => d.date === date);
    if (!day) return;
    const inDay = sessions.filter((s) => s.day === date && s.kind !== 'CLOSING');
    const closing = sessions.find((s) => s.kind === 'CLOSING' && s.day === date);
    const latest = Math.max(toMinutes(dayStart(day)), ...inDay.map((s) => toMinutes(s.endTime)));

    // Khoảng giờ đầu tiên còn chỗ sau phiên muộn nhất; giới hạn bởi họp kết thúc nếu có.
    const spans = day.ranges.map((r) => ({
      s: toMinutes(r.start),
      e: Math.min(toMinutes(r.end), closing ? toMinutes(closing.startTime) : Infinity),
    }));
    const span = spans.find((r) => Math.max(r.s, latest) < r.e);
    let start: number;
    let end: number;
    if (span) {
      start = Math.max(span.s, latest);
      end = Math.min(start + 60, span.e);
    } else {
      // Hết chỗ: đặt vào khoảng cuối, lịch sẽ báo trùng để người dùng chỉnh.
      const r = spans[spans.length - 1];
      start = r.s;
      end = Math.min(r.s + 60, toMinutes(dayEnd(day)));
    }

    const unit = units.find((u) => !scheduledUnits.has(u.id));
    apply([
      ...sessions,
      {
        id: newId(), day: date, startTime: toHHMM(start), endTime: toHHMM(end),
        kind: 'UNIT', unitId: unit?.id ?? null, note: null,
      },
    ]);
  }

  /**
   * Xoá mọi dòng trong lịch, chỉ giữ hai cuộc họp (apply ghim lại chúng).
   * Hoàn tác được.
   */
  function clearSchedule() {
    apply(sessions.filter(isPinned));
  }

  /* ---------------- Lưu ---------------- */

  async function save() {
    if (missingFields.length > 0) {
      setError(`Còn thiếu: ${missingFields.map((f) => f.label).join(', ')}.`);
      return;
    }
    if (brokenDays.length > 0) {
      setError(`Khoảng giờ không hợp lệ: ${brokenDays.join('; ')}.`);
      return;
    }
    if (!check.ok) {
      setError('Lịch chưa đạt các điều kiện ở mục Kiểm tra lịch. Sửa các dòng tô đỏ rồi lưu lại.');
      return;
    }
    // Trùng giờ không chặn lưu — trưởng đoàn quyết định, nhưng phải hỏi một lần.
    if (
      check.conflictRows > 0 &&
      !window.confirm(
        `Lịch còn ${check.conflictRows} dòng bị trùng giờ (tô vàng). Vẫn lưu chương trình như vậy?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/chuong-trinh`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...info,
          // Thời lượng đọc từ lịch, để lần sau tạo lại họp vẫn đúng như vậy.
          openingMinutes: meetingLength(sessions, 'OPENING', info.openingMinutes),
          closingMinutes: meetingLength(sessions, 'CLOSING', info.closingMinutes),
          days: planDays,
          sessions: sessions.map(({ day, startTime, endTime, kind, unitId, note }) => ({
            day, startTime, endTime, kind, unitId: kind === 'UNIT' ? unitId : null, note,
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

  if (planDays.length === 0) {
    return (
      <p className="card p-7 sm:p-8 text-sm text-slate-500">
        Đợt chưa có ngày thực hiện. Quay lại bước tạo đợt để nhập ngày bắt đầu và kết thúc.
      </p>
    );
  }

  const unitsOk = check.missingUnits.length === 0;
  const orderOk = check.orderProblems === 0 && !check.general.some((g) => g.includes('họp'));
  const timeOk = check.timeProblems === 0 && brokenDays.length === 0;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      {/* ============ Thông tin chương trình ============ */}
      <section className="card space-y-4 p-6 sm:p-7">
        <h2 className="text-lg font-semibold">Thông tin chương trình</h2>

        <Field label="Mục tiêu đánh giá" required missing={!info.objectives.trim()}>
          <textarea
            rows={4}
            className="input"
            disabled={locked}
            value={info.objectives}
            onChange={(e) => setInfo((v) => ({ ...v, objectives: e.target.value }))}
          />
        </Field>

        <Field label="Chuẩn mực đánh giá" required missing={!info.criteria.trim()}>
          <textarea
            rows={4}
            className="input"
            disabled={locked}
            value={info.criteria}
            onChange={(e) => setInfo((v) => ({ ...v, criteria: e.target.value }))}
          />
        </Field>

        <Field label="Địa điểm đánh giá" required missing={!info.location.trim()}>
          <input
            className="input"
            disabled={locked}
            value={info.location}
            onChange={(e) => setInfo((v) => ({ ...v, location: e.target.value }))}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Chức danh người phê duyệt" required missing={!info.approverTitle.trim()}>
            <input
              // Hiển thị in hoa bằng CSS. KHÔNG đổi chữ trong onChange: bộ gõ tiếng Việt
              // (Telex/VNI) đang ghép dấu sẽ bị hỏng nếu giá trị bị thay giữa chừng.
              // Giá trị được in hoa thật khi rời ô, khi server lưu và khi xuất Word.
              className="input uppercase"
              disabled={locked}
              placeholder="GIÁM ĐỐC XÍ NGHIỆP"
              value={info.approverTitle}
              onChange={(e) => setInfo((v) => ({ ...v, approverTitle: e.target.value }))}
              onBlur={(e) =>
                setInfo((v) => ({ ...v, approverTitle: e.target.value.toLocaleUpperCase('vi') }))
              }
            />
          </Field>
          <Field label="Họ tên người phê duyệt" required missing={!info.approverName.trim()}>
            <input
              className="input"
              disabled={locked}
              value={info.approverName}
              onChange={(e) => setInfo((v) => ({ ...v, approverName: e.target.value }))}
            />
          </Field>
        </div>
      </section>

      {/* ============ Giờ làm việc từng ngày ============ */}
      <section className="card space-y-4 p-6 sm:p-7">
        <div>
          <h2 className="text-lg font-semibold">Giờ làm việc từng ngày</h2>
          <p className="mt-1 text-sm text-slate-500">
            Mỗi ngày có một hoặc nhiều khoảng giờ làm việc, ví dụ 08:00–11:00 và 14:00–17:00. Thêm
            hoặc bỏ ngày ở tab Thiết lập đợt đánh giá.
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {planDays.map((d, i) => (
            <DayRow
              key={d.date}
              index={i}
              day={d}
              count={(sessionsByDay.get(d.date) ?? []).filter((s) => !isPinned(s)).length}
              locked={locked}
              showApplyAll={i === 0 && planDays.length > 1}
              onRanges={(ranges) => setDayRanges(d.date, ranges)}
              onApplyAll={applyRangesToAll}
            />
          ))}
        </div>

        {brokenDays.length > 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Khoảng giờ không hợp lệ: {brokenDays.join('; ')}.
          </p>
        )}
      </section>

      {/* ============ Lịch đánh giá ============ */}
      <section className="card space-y-5 p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Lịch đánh giá</h2>
          {neverSaved && (
            <span className="chip bg-slate-100 text-slate-600 ring-transparent">Chưa lưu</span>
          )}
          {!locked && (
            <span className="ml-auto flex flex-wrap items-center gap-1" data-history={tick}>
              <button
                onClick={undo}
                disabled={past.current.length === 0}
                title="Hoàn tác (Ctrl+Z)"
                className="btn-ghost !px-2 !py-1 text-sm disabled:opacity-40"
              >
                ↶ Hoàn tác
              </button>
              <button
                onClick={redo}
                disabled={future.current.length === 0}
                title="Làm lại (Ctrl+Shift+Z)"
                className="btn-ghost !px-2 !py-1 text-sm disabled:opacity-40"
              >
                ↷ Làm lại
              </button>
              <button onClick={clearSchedule} className="btn-ghost !px-3 !py-1 text-sm">
                Làm trống lịch
              </button>
            </span>
          )}
        </div>

        {planDays.map((d, i) => (
          <DayTable
            key={d.date}
            index={i}
            day={d}
            rows={sessionsByDay.get(d.date) ?? []}
            units={units}
            scheduledUnits={scheduledUnits}
            unitMembers={unitMembers}
            memberName={memberName}
            issues={check.rowIssues}
            warnings={check.rowWarnings}
            locked={locked}
            onPatch={patchSession}
            onRemove={removeSession}
            onAdd={() => addRow(d.date)}
          />
        ))}

        {/* Phiên lạc ngày — chỉ xảy ra với dữ liệu cũ, nhưng không được giấu đi. */}
        {[...sessionsByDay.keys()].some((k) => !dates.includes(k)) && (
          <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Có phiên nằm ở ngày không còn trong danh sách ngày thực hiện. Bấm “Làm trống lịch” hoặc
            thêm lại ngày đó ở tab Thiết lập đợt đánh giá.
          </p>
        )}

        {/* ============ Kiểm tra lịch ============ */}
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-2 text-sm font-semibold">Kiểm tra lịch</p>
          <ul className="space-y-1.5 text-sm">
            <CheckItem ok={unitsOk}>
              {unitsOk
                ? `Tất cả ${units.length} đơn vị đều có lịch đánh giá`
                : `Chưa xếp lịch cho: ${check.missingUnits.map((u) => u.name).join(', ')}`}
            </CheckItem>
            <CheckItem ok={orderOk}>
              Họp khai mạc là phiên đầu tiên, họp kết thúc là phiên cuối cùng
              {!orderOk && check.orderProblems > 0 && ` (${check.orderProblems} dòng đặt sai chỗ)`}
            </CheckItem>
            <CheckItem ok={timeOk}>
              Mọi phiên nằm trong khoảng giờ làm việc
              {!timeOk && check.timeProblems > 0 && ` (${check.timeProblems} dòng có lỗi)`}
            </CheckItem>
            <CheckItem ok={check.conflictRows === 0} warnOnly>
              {check.conflictRows === 0
                ? 'Không ai bị xếp trùng giờ'
                : `${check.conflictRows} dòng bị trùng giờ`}
            </CheckItem>
          </ul>
          {(!check.ok || check.conflictRows > 0) && (
            <p className="mt-2 text-xs text-slate-500">
              {!check.ok && 'Dòng có lỗi tô đỏ, phải sửa mới lưu được. '}
              {check.conflictRows > 0 && 'Dòng trùng giờ tô vàng, bạn tự quyết định giữ hay sửa.'}
            </p>
          )}
        </div>
      </section>

      {!locked && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
          <button onClick={() => save()} disabled={busy} className="btn-primary">
            {busy ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu chương trình'}
          </button>
          <a href={`/api/audits/${auditId}/xuat-word`} className="btn-ghost inline-flex items-center gap-2">
            <WordIcon />
            Xuất file Word
          </a>
          {missingFields.length > 0 ? (
            <span className="text-xs text-red-600">
              Còn thiếu: {missingFields.map((f) => f.label).join(', ')}
            </span>
          ) : !check.ok ? (
            <span className="text-xs text-red-600">Lịch chưa đạt, xem mục Kiểm tra lịch</span>
          ) : check.conflictRows > 0 ? (
            <span className="text-xs text-amber-700">Còn {check.conflictRows} dòng trùng giờ</span>
          ) : (
            <span className="text-xs text-slate-400">Lưu trước khi xuất file để lấy bản mới nhất</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CheckItem({
  ok, warnOnly, children,
}: {
  ok: boolean;
  /** Chưa đạt thì chỉ cảnh báo (vàng), không phải lỗi chặn lưu (đỏ). */
  warnOnly?: boolean;
  children: React.ReactNode;
}) {
  const tone = ok ? 'text-slate-600' : warnOnly ? 'text-amber-800' : 'text-red-700';
  const mark = ok ? '✓' : warnOnly ? '⚠' : '✗';
  const markTone = ok ? 'text-emerald-600' : warnOnly ? 'text-amber-600' : 'text-red-600';
  return (
    <li className={`flex gap-2 ${tone}`}>
      <span aria-hidden className={markTone}>{mark}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Một ngày thực hiện: các khoảng giờ làm việc và các thao tác đổi / xoá ngày.
 * Đổi và xoá mở một dòng xác nhận ngay bên dưới thay vì hộp thoại.
 */
function DayRow({
  index, day, count, locked, showApplyAll, onRanges, onApplyAll,
}: {
  index: number;
  day: AuditDay;
  /** Số phiên (không tính hai cuộc họp cố định) đang nằm trên ngày này. */
  count: number;
  locked: boolean;
  showApplyAll: boolean;
  onRanges: (ranges: TimeRange[]) => void;
  onApplyAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm first:pt-0 last:pb-0">
      <span className="w-56 shrink-0">
        <strong className="text-slate-700">Ngày {index + 1}</strong>
        <span className="ml-1.5 text-slate-500">{formatDayLong(day.date)}</span>
      </span>

      <RangesEditor ranges={day.ranges} locked={locked} onChange={onRanges} />

      <span className="text-xs text-slate-400">{count > 0 ? `${count} phiên` : ''}</span>

      {!locked && showApplyAll && (
        <button onClick={onApplyAll} className="ml-auto text-xs text-brand-700 hover:underline">
          Áp dụng giờ cho mọi ngày
        </button>
      )}
    </div>
  );
}

/** Các khoảng giờ của một ngày: sửa, bỏ, thêm khoảng. */
function RangesEditor({
  ranges, locked, onChange,
}: {
  ranges: TimeRange[];
  locked: boolean;
  onChange: (ranges: TimeRange[]) => void;
}) {
  const set = (i: number, patch: Partial<TimeRange>) =>
    onChange(sortRanges(ranges.map((r, k) => (k === i ? { ...r, ...patch } : r))));

  /**
   * Khoảng gợi ý khi bấm thêm. Ngày chỉ có buổi chiều thì thêm buổi sáng vào
   * TRƯỚC (08:00 tới trước khoảng đầu một tiếng); còn lại thêm vào SAU khoảng
   * cuối một tiếng, dài ba tiếng.
   */
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  let suggestion: TimeRange | null = null;
  if (first && toMinutes(first.start) >= 12 * 60) {
    const end = Math.min(toMinutes(first.start) - 60, 11 * 60 + 30);
    suggestion = { start: toHHMM(Math.min(8 * 60, end - 60)), end: toHHMM(end) };
  } else {
    const start = last ? Math.ceil((toMinutes(last.end) + 60) / 15) * 15 : 8 * 60;
    if (start + 30 <= 23 * 60) {
      suggestion = { start: toHHMM(start), end: toHHMM(Math.min(start + 180, 23 * 60)) };
    }
  }
  const canAdd = suggestion !== null;

  return (
    <span className="flex flex-col gap-1.5">
      {ranges.map((r, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Từ</span>
          <TimeInput value={r.start} disabled={locked} onCommit={(v) => set(i, { start: v })} />
          <span className="text-xs text-slate-500">đến</span>
          <TimeInput value={r.end} disabled={locked} onCommit={(v) => set(i, { end: v })} />
          {!locked && ranges.length > 1 && (
            <button
              onClick={() => onChange(ranges.filter((_, k) => k !== i))}
              title="Bỏ khoảng giờ này"
              className="px-1 text-slate-400 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {!locked && canAdd && (
        <button
          onClick={() => {
            if (suggestion) onChange(sortRanges([...ranges, suggestion]));
          }}
          className="self-start text-xs text-brand-700 hover:underline"
        >
          + Thêm khoảng giờ
        </button>
      )}
    </span>
  );
}

/**
 * Bảng lịch của một ngày — cùng dạng với bảng in ra file Word.
 *
 * Hai cuộc họp cố định chỉ sửa được thời lượng: khai mạc sửa giờ kết thúc,
 * họp kết thúc sửa giờ bắt đầu. Mốc còn lại bám theo giờ của ngày.
 */
function DayTable({
  index, day, rows, units, scheduledUnits, unitMembers, memberName, issues, warnings, locked,
  onPatch, onRemove, onAdd,
}: {
  index: number;
  day: AuditDay;
  rows: PlanSession[];
  units: Unit[];
  scheduledUnits: Set<string>;
  unitMembers: Map<string, string[]>;
  memberName: Map<string, string>;
  issues: Map<string, string[]>;
  /** Cảnh báo trùng giờ — tô vàng, không chặn lưu. */
  warnings: Map<string, string[]>;
  locked: boolean;
  onPatch: (id: string, patch: Partial<PlanSession>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm">
        <strong>Ngày {index + 1}</strong>
        <span className="ml-1.5 text-slate-600">{formatDayLong(day.date)}</span>
        <span className="ml-2 text-xs text-slate-400">
          {formatRanges(day.ranges)}
        </span>
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        {rows.length === 0 && (
          <p className="px-3 py-3 text-sm text-slate-400">Chưa có phiên nào trong ngày này.</p>
        )}

        {rows.map((s) => {
          const rowIssues = issues.get(s.id) ?? [];
          const rowWarnings = warnings.get(s.id) ?? [];
          const fixed = isPinned(s);
          const people =
            s.kind === 'UNIT'
              ? (s.unitId ? unitMembers.get(s.unitId) ?? [] : []).map((m) => memberName.get(m)).filter(Boolean)
              : null;

          return (
            <div
              key={s.id}
              className={`border-b border-slate-100 px-3 py-2 last:border-b-0 ${
                rowIssues.length > 0
                  ? 'bg-red-50'
                  : rowWarnings.length > 0
                    ? 'bg-amber-50'
                    : fixed
                      ? 'bg-slate-50'
                      : ''
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                {/* Giờ */}
                <span className="flex shrink-0 items-center gap-1">
                  {s.kind === 'OPENING' ? (
                    <span className="w-[5.25rem] px-2 text-slate-500" title="Luôn bắt đầu cùng giờ bắt đầu của ngày">
                      {s.startTime}
                    </span>
                  ) : (
                    <TimeInput
                      value={s.startTime}
                      disabled={locked}
                      onCommit={(v) => onPatch(s.id, { startTime: v })}
                    />
                  )}
                  <span className="text-slate-400">–</span>
                  {s.kind === 'CLOSING' ? (
                    <span className="w-[5.25rem] px-2 text-slate-500" title="Luôn kết thúc cùng giờ kết thúc của ngày">
                      {s.endTime}
                    </span>
                  ) : (
                    <TimeInput
                      value={s.endTime}
                      disabled={locked}
                      onCommit={(v) => onPatch(s.id, { endTime: v })}
                    />
                  )}
                </span>

                {/* Nội dung */}
                <span className="min-w-[12rem] flex-1">
                  {fixed ? (
                    <strong>{KIND_LABELS[s.kind]}</strong>
                  ) : (
                    <select
                      value={s.kind === 'INTERNAL' ? '__INTERNAL__' : s.unitId ?? ''}
                      disabled={locked}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__INTERNAL__') onPatch(s.id, { kind: 'INTERNAL', unitId: null });
                        else onPatch(s.id, { kind: 'UNIT', unitId: v || null });
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">— Chọn đơn vị —</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {scheduledUnits.has(u.id) && u.id !== s.unitId ? ' (đã có lịch)' : ''}
                        </option>
                      ))}
                      <option value="__INTERNAL__">{KIND_LABELS.INTERNAL}</option>
                    </select>
                  )}
                </span>

                {/* Đánh giá viên */}
                <span className="w-48 shrink-0 text-xs text-slate-600">
                  {people === null ? (
                    'Cả đoàn'
                  ) : people.length > 0 ? (
                    people.join(', ')
                  ) : s.unitId ? (
                    <span className="text-amber-700">Chưa phân công</span>
                  ) : (
                    '—'
                  )}
                </span>

                {/* Thao tác */}
                <span className="w-8 shrink-0 text-right">
                  {!locked && !fixed && (
                    <button
                      onClick={() => onRemove(s.id)}
                      title="Xoá dòng"
                      className="text-slate-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>

              {rowIssues.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                  {rowIssues.map((m, i) => (
                    <li key={i}>• {m}</li>
                  ))}
                </ul>
              )}
              {rowWarnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                  {rowWarnings.map((m, i) => (
                    <li key={i}>⚠ {m}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {!locked && (
        <button onClick={onAdd} className="mt-2 text-sm text-brand-700 hover:underline">
          + Thêm dòng vào ngày {formatDayShort(day.date).slice(0, 5)}
        </button>
      )}
    </div>
  );
}

/**
 * Ô giờ chỉ báo giá trị khi rời ô: gõ dở "08:3" mà lịch đã nhảy theo thì bảng
 * sắp xếp lại dưới tay người đang gõ.
 */
function TimeInput({
  value, onCommit, disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      type="time"
      step={300}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (/^\d\d:\d\d$/.test(draft) && draft !== value) onCommit(draft);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
    />
  );
}

function Field({
  label, children, required, missing,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  /** Bắt buộc mà đang để trống — viền đỏ để tìm ra ngay giữa một trang dài. */
  missing?: boolean;
}) {
  return (
    <div className={missing ? '[&_.input]:border-red-400' : undefined}>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
    </div>
  );
}
