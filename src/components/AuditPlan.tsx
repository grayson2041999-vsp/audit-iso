'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildShortNames } from '@/lib/utils';
import { PlanCalculator } from './PlanCalculator';
import { ScheduleGrid } from './ScheduleGrid';
import { UnitPalette } from './UnitPalette';
import {
  KIND_LABELS, MIN_MANUAL, blockedSpans, checkWorkingHours, computeCapacity, durationLabel,
  findTimeConflicts, freeSpans, generateTimedPlan, nearestStart, toHHMM, toMinutes,
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
  /** Đơn vị đang được nhấc lên từ kho, để lưới làm sáng dòng đích. */
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  /**
   * Thời lượng mặc định cho phiên mới. null nghĩa là dùng con số hệ thống tự
   * tính — giữ null thay vì chép giá trị vào state để nó tự đúng theo khi
   * trưởng đoàn sửa giờ làm việc hoặc thêm ngày.
   */
  const [targetOverride, setTargetOverride] = useState<number | null>(null);

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
    return `Sau khi lưu lịch, ${parts.join(' và ')}. Kéo đơn vị từ kho xuống lưới để cập nhật.`;
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

  /**
   * Thời lượng hai cuộc họp ĐỌC TỪ LỊCH, không phải từ ô nhập riêng.
   *
   * Trước đây có hai ô số cho việc này, nhưng khối trên lịch kéo giãn được nên
   * cùng một sự thật có hai nơi ghi — kéo khối xong thì con số trong ô sai, sửa
   * con số thì khối không đổi. Bỏ ô đi, lấy khối làm gốc: kéo mép khối họp là
   * xong. Con số vẫn được lưu xuống database để file Word và lần mở sau dùng.
   *
   * Chưa có khối nào thì lấy giá trị đã lưu làm mặc định — lúc đó nó là hạt
   * giống cho lần xếp lịch đầu tiên chứ chưa phải bản sao của cái gì.
   */
  function meetingMinutes(kind: SessionKind, day: string, fallback: number) {
    const s = sessions.find((x) => x.kind === kind && x.day === day);
    return s ? Math.max(0, toMinutes(s.endTime) - toMinutes(s.startTime)) : fallback;
  }

  const hours: Hours = {
    amStart: info.amStart,
    amEnd: info.amEnd,
    pmStart: info.pmStart,
    pmEnd: info.pmEnd,
    openingMinutes: meetingMinutes('OPENING', days[0], initialInfo.openingMinutes),
    closingMinutes: meetingMinutes('CLOSING', days[days.length - 1], initialInfo.closingMinutes),
  };

  const capacity = useMemo(
    () => computeCapacity({ days, hours, units, unitMembers }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, hours.amStart, hours.amEnd, hours.pmStart, hours.pmEnd,
     hours.openingMinutes, hours.closingMinutes, units, unitMembers],
  );

  /** Thời lượng nên dành cho mỗi đơn vị — hệ thống tính, trưởng đoàn đè lên được. */
  const targetMinutes = targetOverride ?? capacity.perUnitMinutes;

  /**
   * Đã xếp bao nhiêu phút cho từng đơn vị. Một đơn vị có thể tách làm nhiều
   * phiên nên phải cộng dồn, không thể đếm khối.
   */
  const allocated = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (s.kind !== 'UNIT' || !s.unitId) continue;
      const mins = toMinutes(s.endTime) - toMinutes(s.startTime);
      map.set(s.unitId, (map.get(s.unitId) ?? 0) + Math.max(0, mins));
    }
    return map;
  }, [sessions]);

  const unscheduled = units.filter((u) => !allocated.has(u.id));

  /**
   * Phiên nào không nằm trọn trong khung giờ làm việc.
   *
   * Dùng cho cả hai việc: hiện danh sách dưới lưới, và chặn lưu. Nhận `list` và
   * `hours` làm tham số chứ không đọc thẳng state, vì lúc kiểm tra trước khi
   * lưu thì state chưa kịp cập nhật theo thay đổi vừa tính ra.
   */
  function findHoursIssues(list: PlanSession[], hours: PlanInfo) {
    const out: string[] = [];
    for (const s of list) {
      const issue = checkWorkingHours(s, hours);
      if (!issue) continue;
      const unit = units.find((u) => u.id === s.unitId);
      const what = s.kind === 'UNIT' ? unit?.name ?? 'Phiên' : KIND_LABELS[s.kind];
      out.push(`${what} ${s.startTime}–${s.endTime}: ${issue}`);
    }
    return out;
  }

  /** Lưới không đủ chỗ hiện chữ, nên gom lỗi giờ giấc thành danh sách bên dưới. */
  const hoursIssues = useMemo(
    () => findHoursIssues(sessions, info),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, info, units],
  );

  /** Khung giờ có tự mâu thuẫn không — sáng phải trước trưa, trưa phải trước chiều. */
  const hoursBroken =
    toMinutes(info.amEnd) <= toMinutes(info.amStart) ||
    toMinutes(info.pmStart) < toMinutes(info.amEnd) ||
    toMinutes(info.pmEnd) <= toMinutes(info.pmStart);

  const unitById = new Map(units.map((u) => [u.id, u]));
  const shortById = new Map(members.map((m, i) => [m.id, shortNames[i]]));

  /* ---------------- Hoàn tác ---------------- */

  /**
   * Lịch sử chỉ cho LỊCH, không cho các ô chữ — ô chữ đã có Ctrl+Z sẵn của
   * trình duyệt, chen vào đó chỉ làm hỏng thứ người dùng vốn đã quen.
   *
   * Giữ trong ref chứ không trong state: đẩy một bước không cần vẽ lại gì, chỉ
   * hai nút Hoàn tác / Làm lại cần biết nên mới có `tick`.
   */
  const past = useRef<PlanSession[][]>([]);
  const future = useRef<PlanSession[][]>([]);
  const lastMark = useRef<{ tag: string; at: number } | null>(null);
  const [tick, setTick] = useState(0);

  /**
   * Ghi lại trạng thái TRƯỚC khi đổi.
   *
   * `tag` để gộp các thao tác liên tiếp cùng loại thành một bước: gõ vào ô giờ
   * hay giữ phím mũi tên phát ra hàng chục lần đổi, mà người dùng chỉ coi đó là
   * một lần sửa — bấm Hoàn tác phải quay về trước cả chuỗi, không phải lùi từng
   * 5 phút một.
   */
  function snapshot(tag?: string) {
    const now = Date.now();
    if (tag && lastMark.current?.tag === tag && now - lastMark.current.at < 700) {
      lastMark.current.at = now;
      return;
    }
    lastMark.current = tag ? { tag, at: now } : null;

    past.current = [...past.current, sessions].slice(-60);
    future.current = [];
    setTick((t) => t + 1);
  }

  function undo() {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, sessions];
    lastMark.current = null;
    setSessions(prev);
    setTick((t) => t + 1);
  }

  function redo() {
    const next = future.current[future.current.length - 1];
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, sessions];
    lastMark.current = null;
    setSessions(next);
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

  /* ---------------- Thao tác ---------------- */

  /** Không tự ghi lịch sử: lúc kéo, hàm này chạy mỗi lần chuột nhúc nhích. */
  function patchSession(id: string, patch: Partial<PlanSession>) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSession(id: string) {
    snapshot();
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  const newId = () => `tam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  /** Phiên thả từ kho xuống — lưới đã tính sẵn giờ hợp lệ. */
  function createSession(day: string, unitId: string, startTime: string, endTime: string) {
    snapshot();
    setSessions((prev) => [
      ...prev,
      { id: newId(), day, startTime, endTime, kind: 'UNIT', unitId, note: null },
    ]);
  }

  /**
   * Thêm một cuộc họp. Trước đây hàm này xếp mù ngay sau phiên cuối trong ngày,
   * nên thêm vào ngày cuối là rơi đúng vào họp kết thúc. Giờ nó đi tìm chỗ
   * trống thật, theo cùng bộ luật với thao tác kéo.
   */
  function addMeeting(day: string, kind: SessionKind) {
    const self = { id: '__moi__', day, kind, unitId: null };
    const free = freeSpans(blockedSpans({ self, sessions, hours, unitMembers }), hours);

    const widest = free.reduce((mx, f) => Math.max(mx, f.end - f.start), 0);
    const dur = Math.max(MIN_MANUAL, Math.min(60, widest));
    const start = nearestStart(toMinutes(hours.amStart), dur, free);
    if (start === null) {
      setError(`Ngày này không còn chỗ trống cho ${KIND_LABELS[kind].toLowerCase()}.`);
      return;
    }

    snapshot();
    setSessions((prev) => [
      ...prev,
      {
        id: newId(),
        day,
        startTime: toHHMM(start),
        endTime: toHHMM(start + dur),
        kind,
        unitId: null,
        note: null,
      },
    ]);
  }

  async function save() {
    const list = sessions;

    /**
     * Không lưu khi còn phiên nằm ngoài giờ làm việc. Chặn ở đây chứ không ở
     * từng nút, để không có đường vòng: sửa giờ rồi bấm Lưu chương trình ở
     * chân trang cũng phải qua cửa này.
     */
    if (hoursBroken) {
      setError('Khung giờ không hợp lệ: giờ sáng phải trước giờ trưa, giờ trưa trước giờ chiều.');
      return;
    }
    const issues = findHoursIssues(list, info);
    if (issues.length > 0) {
      setError(
        `Còn ${issues.length} phiên nằm ngoài khung giờ làm việc — xem danh sách dưới lưới. ` +
          'Kéo hoặc rút ngắn các phiên đó cho vừa giờ mới, rồi lưu lại.',
      );
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
          // Ghi con số đọc từ lịch, để file Word và lần mở sau khớp với lưới.
          openingMinutes: hours.openingMinutes,
          closingMinutes: hours.closingMinutes,
          sessions: list.map(({ day, startTime, endTime, kind, unitId, note }) => ({
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

        {hoursBroken ? (
          <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Giờ sáng phải trước giờ trưa, giờ trưa trước giờ chiều.
          </p>
        ) : (
          <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
            Họp khai mạc <strong>{durationLabel('00:00', toHHMM(hours.openingMinutes))}</strong> ·
            họp kết thúc <strong>{durationLabel('00:00', toHHMM(hours.closingMinutes))}</strong> —
            đọc thẳng từ lịch bên dưới. Muốn đổi thì kéo mép khối họp trên lưới.
          </p>
        )}
      </section>

      <PlanCalculator
        unitCount={units.length}
        actualDays={days.length}
        actualMembers={members.length}
        minutesPerDay={minutesPerDay}
        openingMinutes={hours.openingMinutes}
        closingMinutes={hours.closingMinutes}
        busiestRounds={busiestRounds}
      />

      <UnitPalette
        units={units}
        targetMinutes={targetMinutes}
        allocated={allocated}
        unitMembers={unitMembers}
        shortById={shortById}
        locked={locked}
        onDragStart={setDraggingUnitId}
        onDragEnd={() => setDraggingUnitId(null)}
      />

      {/* ============ Lịch đánh giá ============ */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Lịch đánh giá</h2>

          {!locked && (
            <span className="flex items-center gap-1" data-history={tick}>
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
            </span>
          )}

          {!locked && (
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Mỗi đơn vị
              <input
                type="number"
                min={MIN_MANUAL}
                step={5}
                value={targetMinutes}
                onChange={(e) => setTargetOverride(Math.max(MIN_MANUAL, Number(e.target.value) || MIN_MANUAL))}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
              phút
              {targetOverride !== null && (
                <button
                  onClick={() => setTargetOverride(null)}
                  className="text-xs text-brand-600 hover:underline"
                >
                  về mức tự tính
                </button>
              )}
            </label>
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

        {capacity.capped && (
          <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            Quỹ thời gian chia ra còn dư. Một phiên không thể vắt qua giờ nghỉ trưa hay sang
            ngày hôm sau, nên mỗi đơn vị lấy tối đa{' '}
            <strong>{durationLabel('00:00', toHHMM(capacity.longestWindow))}</strong> — đúng bằng
            buổi làm việc dài nhất. Phần dôi ra để trống trong lịch, bạn dùng vào việc gì tuỳ ý.
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
          hours={hours}
          sessions={sessions}
          units={units}
          members={members.map((m, i) => ({ ...m, short: shortNames[i] }))}
          unitMembers={unitMembers}
          conflictIds={conflicts.ids}
          locked={locked}
          draggingUnitId={draggingUnitId}
          defaultMinutes={targetMinutes}
          onPatch={patchSession}
          onRemove={removeSession}
          onCreate={createSession}
          onSnapshot={snapshot}
        />

        {!locked && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <AddMeetingRow days={days} onAdd={addMeeting} />
          </div>
        )}

        {hoursIssues.length > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p className="font-medium">
              Phiên nằm ngoài giờ làm việc — phải xử lý xong mới lưu được:
            </p>
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
          <button onClick={() => save()} disabled={busy} className="btn-primary">
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

/**
 * Thêm cuộc họp. Đơn vị không nằm ở đây nữa — kéo từ kho xuống đúng chỗ mình
 * muốn thì nhanh và rõ hơn chọn trong danh sách rồi đi tìm xem nó rơi vào đâu.
 */
function AddMeetingRow({
  days, onAdd,
}: {
  days: string[];
  onAdd: (day: string, kind: SessionKind) => void;
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
          onAdd(day, v as SessionKind);
          setValue('');
        }}
        className="flex-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-sm text-slate-500"
      >
        <option value="">+ Thêm cuộc họp…</option>
        <option value="OPENING">{KIND_LABELS.OPENING}</option>
        <option value="INTERNAL">{KIND_LABELS.INTERNAL}</option>
        <option value="CLOSING">{KIND_LABELS.CLOSING}</option>
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
      step={300} // bước 5 phút, cùng nhịp với thao tác kéo trên lưới
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
