'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildShortNames } from '@/lib/utils';
import { ScheduleGrid } from './ScheduleGrid';
import { UnitPalette } from './UnitPalette';
import { WordIcon } from './FileIcons';
import {
  KIND_LABELS, MIN_MANUAL, blockedSpans, checkWorkingHours, computeCapacity, durationLabel,
  formatDayLong, formatDayShort, toDayString,
  findTimeConflicts, freeSpans, generateTimedPlan, nearestStart, reflowToHours, toHHMM, toMinutes,
  type AuditDay, type DayHours, type Hours, type PlanSession, type SessionKind,
} from '@/lib/plan';

type Unit = { id: string; name: string };
type Member = { id: string; fullName: string };

type PlanInfo = {
  objectives: string;
  criteria: string;
  location: string;
  approverTitle: string;
  approverName: string;
  /** Khung giờ mặc định của đợt — dùng cho ngày nào chưa khai riêng. */
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
/** Bốn mốc giờ của một ngày, tách khỏi ngày dương lịch và các trường khác. */
const pickHours = (d: DayHours): DayHours => ({
  amStart: d.amStart, amEnd: d.amEnd, pmStart: d.pmStart, pmEnd: d.pmEnd,
});

const sortDays = (list: AuditDay[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));

const hoursMap = (list: AuditDay[]) =>
  Object.fromEntries(list.map((d) => [d.date, pickHours(d)])) as Record<string, DayHours>;

/** "YYYY-MM-DD" hợp lệ và năm nằm trong khoảng hợp lý — chặn ô ngày đang gõ dở. */
const isValidDay = (v: string) => /^(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);

export function AuditPlan({
  auditId, initialDays, units, members, assignments, initialInfo, initialSessions, locked,
}: {
  auditId: string;
  /** Ngày thực hiện đã lưu, đã sắp xếp. Không cần liền nhau. */
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
  /**
   * Ngày thực hiện — danh sách ngày cụ thể, mỗi ngày một khung giờ riêng.
   *
   * Thực tế họp khai mạc một ngày, đánh giá vài ngày rời rạc, họp kết thúc một
   * ngày khác, và kế hoạch hay bị dời. Nên ngày được thêm, đổi, xoá ngay ở đây,
   * cùng chỗ với lịch, và chỉ ghi xuống khi bấm Lưu như mọi thứ khác.
   */
  const [planDays, setPlanDays] = useState<AuditDay[]>(() => sortDays(initialDays));
  const days = useMemo(() => planDays.map((d) => d.date), [planDays]);
  const dayIndex = useMemo(() => new Map(days.map((d, i) => [d, i])), [days]);
  /**
   * Đơn vị đang chọn ở kho, chờ bấm vào lưới để đặt phiên.
   *
   * Kéo thả vẫn dùng được, nhưng không phải đường chính: khi lưới nằm ngoài
   * màn hình thì kéo tới mép trang trình duyệt không tự cuộn, coi như bế tắc.
   * Bấm chọn rồi bấm đặt thì cuộn thoải mái giữa hai lần bấm.
   */
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const activeUnitId = draggingUnitId ?? selectedUnitId;
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

  const build = (hoursOf: (day: string) => Hours) =>
    generateTimedPlan({ days, hoursOf, units, unitMembers, allMemberIds });

  /**
   * Chưa lưu lịch bao giờ thì tính sẵn ngay khi mở tab — không bắt bấm nút để
   * tạo ra thứ mà hệ thống đã tự suy ra được từ ngày, đơn vị và phân công.
   * Bản tính sẵn này CHƯA vào database, chỉ ghi khi bấm Lưu chương trình.
   */
  const [sessions, setSessions] = useState<PlanSession[]>(() => {
    if (initialSessions.length > 0) return initialSessions;
    const byDate = new Map(initialDays.map((d) => [d.date, d]));
    return build((day) => {
      const d = byDate.get(day);
      return {
        ...initialInfo,
        ...(d ? pickHours(d) : {}),
        meetingOnly: d?.meetingOnly,
      };
    }).sessions.map((x, i) => ({
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

  const openingMinutes = meetingMinutes('OPENING', days[0], initialInfo.openingMinutes);
  const closingMinutes = meetingMinutes(
    'CLOSING', days[days.length - 1], initialInfo.closingMinutes,
  );

  /** Khung giờ của một ngày. Thời lượng hai cuộc họp là của cả đợt nên gắn kèm. */
  function hoursOf(day: string): Hours {
    const d = planDays[dayIndex.get(day) ?? 0] ?? planDays[0];
    return {
      ...pickHours(d ?? info),
      meetingOnly: d?.meetingOnly,
      openingMinutes,
      closingMinutes,
    };
  }

  const capacity = useMemo(
    () => computeCapacity({ days, hoursOf, units, unitMembers }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, planDays, openingMinutes, closingMinutes, units, unitMembers],
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
   * Các ô bắt buộc của chương trình đánh giá.
   *
   * Cả năm đều xuất thẳng ra file Word: thiếu mục tiêu và chuẩn mực thì văn bản
   * không còn là chương trình đánh giá theo ISO 19011, thiếu chức danh và họ tên
   * người phê duyệt thì khối ký trống không ai duyệt được.
   */
  const REQUIRED: { key: keyof PlanInfo; label: string }[] = [
    { key: 'objectives', label: 'Mục tiêu đánh giá' },
    { key: 'criteria', label: 'Chuẩn mực đánh giá' },
    { key: 'location', label: 'Địa điểm đánh giá' },
    { key: 'approverTitle', label: 'Chức danh người phê duyệt' },
    { key: 'approverName', label: 'Họ tên người phê duyệt' },
  ];

  const missingFields = REQUIRED.filter((f) => !String(info[f.key] ?? '').trim());

  /**
   * Phiên nào không nằm trọn trong khung giờ làm việc.
   *
   * Dùng cho cả hai việc: hiện danh sách dưới lưới, và chặn lưu. Nhận `list` và
   * `hours` làm tham số chứ không đọc thẳng state, vì lúc kiểm tra trước khi
   * lưu thì state chưa kịp cập nhật theo thay đổi vừa tính ra.
   */
  function findHoursIssues(list: PlanSession[]) {
    const out: string[] = [];
    for (const s of list) {
      const issue = checkWorkingHours(s, hoursOf(s.day));
      if (!issue) continue;
      const unit = units.find((u) => u.id === s.unitId);
      const what = s.kind === 'UNIT' ? unit?.name ?? 'Phiên' : KIND_LABELS[s.kind];
      out.push(`${what} ${s.startTime}–${s.endTime}: ${issue}`);
    }
    return out;
  }

  /** Lưới không đủ chỗ hiện chữ, nên gom lỗi giờ giấc thành danh sách bên dưới. */
  const hoursIssues = useMemo(
    () => findHoursIssues(sessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, planDays, units],
  );

  /** Khung giờ một ngày có tự mâu thuẫn không — sáng trước trưa, trưa trước chiều. */
  const broken = (d: DayHours) =>
    toMinutes(d.amEnd) <= toMinutes(d.amStart) ||
    toMinutes(d.pmStart) < toMinutes(d.amEnd) ||
    toMinutes(d.pmEnd) <= toMinutes(d.pmStart);

  const brokenDays = planDays.map((d, i) => ({ i, d })).filter(({ d }) => broken(d)).map(({ i }) => i + 1);

  /** Số phiên và các cuộc họp đang nằm trên từng ngày — hiện cạnh ngày, và để hỏi trước khi xoá. */
  const sessionsByDay = useMemo(() => {
    const map = new Map<string, { count: number; kinds: Set<SessionKind> }>();
    for (const s of sessions) {
      const e = map.get(s.day) ?? { count: 0, kinds: new Set<SessionKind>() };
      e.count += 1;
      e.kinds.add(s.kind);
      map.set(s.day, e);
    }
    return map;
  }, [sessions]);

  /** Không chặn lưu — có đợt chỉ họp kết thúc chung với đợt khác — nhưng phải thấy. */
  const meetingWarnings = [
    !sessions.some((s) => s.kind === 'OPENING') && 'chưa có họp khai mạc',
    !sessions.some((s) => s.kind === 'CLOSING') && 'chưa có họp kết thúc',
  ].filter(Boolean) as string[];

  const hoursBroken = brokenDays.length > 0;

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
  /**
   * Một bước lịch sử. `days` chỉ có khi bước đó thêm / đổi / xoá ngày — hoàn tác
   * thao tác kéo phiên thì không được tiện tay trả luôn khung giờ vừa gõ.
   */
  type Snap = { sessions: PlanSession[]; days?: AuditDay[] };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
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
  function snapshot(tag?: string, opts?: { days?: boolean }) {
    const now = Date.now();
    if (tag && lastMark.current?.tag === tag && now - lastMark.current.at < 700) {
      lastMark.current.at = now;
      return;
    }
    lastMark.current = tag ? { tag, at: now } : null;

    past.current = [...past.current, { sessions, days: opts?.days ? planDays : undefined }].slice(-60);
    future.current = [];
    setTick((t) => t + 1);
  }

  /** Đưa một bước lịch sử về màn hình, trả về bước tương ứng của hiện tại để cất sang phía kia. */
  function restore(snap: Snap): Snap {
    const mirror: Snap = { sessions, days: snap.days ? planDays : undefined };
    setSessions(snap.sessions);
    if (snap.days) {
      setPlanDays(snap.days);
      committedHours.current = hoursMap(snap.days);
    }
    lastMark.current = null;
    setTick((t) => t + 1);
    return mirror;
  }

  function undo() {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, restore(prev)];
  }

  function redo() {
    const next = future.current[future.current.length - 1];
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, restore(next)];
  }

  useEffect(() => {
    if (locked) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectedUnitId(null);
        return;
      }
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

  /* ---------------- Khung giờ ---------------- */

  /**
   * Khung giờ mà lịch đã được nắn theo, giữ riêng cho từng ngày.
   *
   * Ô nhập cập nhật state ngay từng ký tự để trục thời gian chạy theo, nhưng
   * việc nắn lịch chỉ chạy khi rời khỏi ô — gõ dở "08:3" mà máy đã đi cắt phiên
   * thì lịch nát trước khi bạn gõ xong.
   */
  /** Đánh chỉ số theo NGÀY DƯƠNG LỊCH: thêm, xoá ngày ở giữa không làm lệch ngày khác. */
  const committedHours = useRef<Record<string, DayHours>>(hoursMap(planDays));

  function patchDay(i: number, patch: Partial<DayHours>) {
    setPlanDays((prev) => prev.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }

  /** Chép khung giờ ngày 1 cho mọi ngày còn lại — đa số đợt giờ giấc giống nhau. */
  function applyToAllDays() {
    const first = planDays[0];
    if (!first) return;
    const next = planDays.map((d) => ({ ...d, ...pickHours(first) }));
    setPlanDays(next);
    commitHours(next);
  }

  /**
   * `target` để những thao tác đổi giờ bằng nút truyền thẳng mảng mới vào —
   * state chưa kịp cập nhật trong cùng một lượt xử lý sự kiện.
   */
  function commitHours(target?: AuditDay[]) {
    if (locked) return;
    const now = target ?? planDays;
    if (now.some((d) => broken(d))) return;

    const nowByDate = hoursMap(now);
    const before = committedHours.current;
    const next = reflowToHours({
      sessions,
      days: now.map((d) => d.date),
      // Ngày chưa từng nắn (vừa thêm) coi như không đổi gì.
      fromOf: (day) => before[day] ?? nowByDate[day] ?? pickHours(info),
      toOf: (day) => ({ ...(nowByDate[day] ?? pickHours(info)), openingMinutes, closingMinutes }),
    });
    committedHours.current = nowByDate;

    const changed =
      next.length !== sessions.length ||
      next.some((s, i) => s.startTime !== sessions[i]?.startTime || s.endTime !== sessions[i]?.endTime);
    if (!changed) return;

    snapshot();
    setSessions(next);
  }

  /* ---------------- Ngày thực hiện ---------------- */

  /** Gợi ý cho ô thêm ngày: ngày làm việc kế tiếp sau ngày cuối, chưa có trong danh sách. */
  function suggestNextDay(): string {
    const last = days[days.length - 1];
    const [y, m, d] = (last ?? toDayString(new Date())).split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    for (let k = 0; k < 30; k++) {
      cur.setDate(cur.getDate() + 1);
      const s = toDayString(cur);
      if (cur.getDay() !== 0 && cur.getDay() !== 6 && !days.includes(s)) return s;
    }
    return toDayString(cur);
  }

  function addDay(date: string): boolean {
    if (!isValidDay(date)) {
      setError('Ngày không hợp lệ.');
      return false;
    }
    if (days.includes(date)) {
      setError(`${formatDayLong(date)} đã có trong danh sách ngày thực hiện.`);
      return false;
    }
    // Khung giờ lấy theo ngày liền trước nó — gần như chắc chắn giờ giấc giống nhau.
    const before = planDays.filter((d) => d.date < date).pop() ?? planDays[0];
    const hours = pickHours(before ?? info);

    snapshot(undefined, { days: true });
    setPlanDays(sortDays([...planDays, { date, ...hours }]));
    committedHours.current = { ...committedHours.current, [date]: hours };
    setError(null);
    return true;
  }

  /** Đổi ngày dương lịch của một ngày — mọi phiên trên ngày đó đi theo, giữ nguyên giờ. */
  function moveDay(from: string, to: string): boolean {
    if (from === to) return true;
    if (!isValidDay(to)) {
      setError('Ngày không hợp lệ.');
      return false;
    }
    if (days.includes(to)) {
      setError(`${formatDayLong(to)} đã có trong danh sách. Xoá ngày đó trước, hoặc chọn ngày khác.`);
      return false;
    }

    snapshot(undefined, { days: true });
    setPlanDays(sortDays(planDays.map((d) => (d.date === from ? { ...d, date: to } : d))));
    setSessions(sessions.map((s) => (s.day === from ? { ...s, day: to } : s)));
    const rest = { ...committedHours.current };
    const moved = rest[from];
    delete rest[from];
    committedHours.current = moved ? { ...rest, [to]: moved } : rest;
    setError(null);
    return true;
  }

  /**
   * Xoá một ngày. Phiên trên ngày đó không bao giờ mất ngầm: hoặc chuyển nguyên
   * giờ sang ngày khác, hoặc bỏ khỏi lịch (đơn vị quay về kho, chờ xếp lại).
   */
  function removeDay(date: string, sessionsTo: string | null) {
    if (planDays.length <= 1) return;
    snapshot(undefined, { days: true });
    setPlanDays(planDays.filter((d) => d.date !== date));
    setSessions(
      sessionsTo
        ? sessions.map((s) => (s.day === date ? { ...s, day: sessionsTo } : s))
        : sessions.filter((s) => s.day !== date),
    );
    const rest = { ...committedHours.current };
    delete rest[date];
    committedHours.current = rest;
    setError(null);
  }

  function toggleMeetingOnly(date: string) {
    snapshot(undefined, { days: true });
    setPlanDays(planDays.map((d) => (d.date === date ? { ...d, meetingOnly: !d.meetingOnly } : d)));
  }

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
    setSelectedUnitId(null);
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
    const h = hoursOf(day);
    const self = { id: '__moi__', day, kind, unitId: null };
    const free = freeSpans(blockedSpans({ self, sessions, hours: h, unitMembers }), h);

    const widest = free.reduce((mx, f) => Math.max(mx, f.end - f.start), 0);
    const dur = Math.max(MIN_MANUAL, Math.min(60, widest));
    const start = nearestStart(toMinutes(h.amStart), dur, free);
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
     * Các điều kiện chặn, đặt ở đây chứ không ở từng nút để không có đường vòng.
     *
     * Phiên nằm ngoài giờ làm việc thì không cần chặn nữa — đổi khung giờ đã tự
     * nắn lịch. Còn lại là những thứ máy không suy ra hộ được: ô bắt buộc bỏ
     * trống, và chương trình bỏ sót đơn vị — cả hai đều khiến file Word xuất ra
     * bị khuyết.
     */
    if (missingFields.length > 0) {
      setError(`Còn thiếu: ${missingFields.map((f) => f.label).join(', ')}.`);
      return;
    }
    if (hoursBroken) {
      setError(
        `Khung giờ ngày ${brokenDays.join(', ')} không hợp lệ: ` +
          'giờ sáng phải trước giờ trưa, giờ trưa trước giờ chiều.',
      );
      return;
    }
    if (unscheduled.length > 0) {
      setError(
        `Chưa xếp lịch cho: ${unscheduled.map((u) => u.name).join(', ')}. ` +
          'Kéo các đơn vị đó từ kho xuống lưới rồi lưu lại.',
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
          openingMinutes,
          closingMinutes,
          days: planDays,
          // Ngày 1 làm khung giờ mặc định của đợt.
          ...(planDays[0] ? pickHours(planDays[0]) : {}),
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
      <p className="card p-7 sm:p-8 text-sm text-slate-500">
        Đợt chưa có ngày thực hiện. Quay lại bước tạo đợt để nhập ngày bắt đầu và kết thúc.
      </p>
    );
  }

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

      {/* ============ Ngày thực hiện và khung giờ ============ */}
      <section className="card space-y-4 p-6 sm:p-7">
        <div>
          <h2 className="text-lg font-semibold">Ngày thực hiện và khung giờ</h2>
          <p className="mt-1 text-sm text-slate-500">
            Các ngày không cần liền nhau. Đổi hoặc xoá một ngày thì các phiên trên ngày đó đi
            theo; bấm Lưu chương trình để ghi lại.
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {planDays.map((d, i) => (
            <DayRow
              key={d.date}
              index={i}
              day={d}
              otherDays={days.filter((x) => x !== d.date)}
              usage={sessionsByDay.get(d.date)}
              locked={locked}
              canRemove={planDays.length > 1}
              showApplyAll={i === 0 && planDays.length > 1}
              onPatch={(patch) => patchDay(i, patch)}
              onCommit={() => commitHours()}
              onApplyAll={applyToAllDays}
              onMove={(to) => moveDay(d.date, to)}
              onRemove={(to) => removeDay(d.date, to)}
              onToggleMeetingOnly={() => toggleMeetingOnly(d.date)}
            />
          ))}
        </div>

        {!locked && <AddDayRow suggest={suggestNextDay} onAdd={addDay} />}

        {hoursBroken ? (
          <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Ngày {brokenDays.join(', ')}: giờ sáng phải trước giờ trưa, giờ trưa trước giờ chiều.
          </p>
        ) : (
          <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
            {planDays.length} ngày · họp khai mạc{' '}
            <strong>{durationLabel('00:00', toHHMM(openingMinutes))}</strong> · họp kết thúc{' '}
            <strong>{durationLabel('00:00', toHHMM(closingMinutes))}</strong>
          </p>
        )}
      </section>

      <UnitPalette
        units={units}
        targetMinutes={targetMinutes}
        allocated={allocated}
        unitMembers={unitMembers}
        shortById={shortById}
        locked={locked}
        selectedId={selectedUnitId}
        onSelect={setSelectedUnitId}
        onDragStart={setDraggingUnitId}
        onDragEnd={() => setDraggingUnitId(null)}
      />

      {/* ============ Lịch đánh giá ============ */}
      <section className="card p-6 sm:p-7">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Lịch đánh giá</h2>

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
                  className="text-xs text-brand-700 hover:underline"
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

        {meetingWarnings.length > 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Lịch {meetingWarnings.join(' và ')}. Thêm bằng ô “+ Thêm cuộc họp” dưới lưới.
          </p>
        )}

        {unscheduled.length > 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Chưa xếp lịch cho: <strong>{unscheduled.map((u) => u.name).join(', ')}</strong>. Kéo
            từ kho xuống lưới — còn đơn vị chưa xếp thì chưa lưu được.
          </p>
        )}

        <ScheduleGrid
          days={days}
          hoursOf={hoursOf}
          sessions={sessions}
          units={units}
          members={members.map((m, i) => ({ ...m, short: shortNames[i] }))}
          unitMembers={unitMembers}
          conflictIds={conflicts.ids}
          locked={locked}
          activeUnitId={activeUnitId}
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
          <button onClick={() => save()} disabled={busy} className="btn-primary">
            {busy ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu chương trình'}
          </button>
          <a
            href={`/api/audits/${auditId}/xuat-word`}
            className="btn-ghost inline-flex items-center gap-2"
          >
            <WordIcon />
            Xuất file Word
          </a>
          {missingFields.length > 0 ? (
            <span className="text-xs text-red-600">
              Còn thiếu: {missingFields.map((f) => f.label).join(', ')}
            </span>
          ) : (
            <span className="text-xs text-slate-400">Lưu trước khi xuất file để lấy bản mới nhất</span>
          )}
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
  const [picked, setDay] = useState(days[0] ?? '');
  // Ngày đang chọn có thể vừa bị xoá hoặc đổi ở phần Ngày thực hiện.
  const day = days.includes(picked) ? picked : days[0] ?? '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      >
        {days.map((d, i) => (
          <option key={d} value={d}>Ngày {i + 1} — {formatDayShort(d)}</option>
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

/**
 * Một ngày thực hiện: khung giờ, và các thao tác đổi ngày / xoá ngày.
 *
 * Đổi ngày và xoá ngày mở một dòng xác nhận ngay bên dưới thay vì hộp thoại —
 * người dùng vẫn nhìn thấy ngày mình đang sửa và số phiên nằm trên đó.
 */
function DayRow({
  index, day, otherDays, usage, locked, canRemove, showApplyAll,
  onPatch, onCommit, onApplyAll, onMove, onRemove, onToggleMeetingOnly,
}: {
  index: number;
  day: AuditDay;
  /** Các ngày còn lại — đích để chuyển phiên khi xoá ngày này. */
  otherDays: string[];
  usage?: { count: number; kinds: Set<SessionKind> };
  locked: boolean;
  canRemove: boolean;
  showApplyAll: boolean;
  onPatch: (patch: Partial<DayHours>) => void;
  onCommit: () => void;
  onApplyAll: () => void;
  onMove: (to: string) => boolean;
  /** `to` = ngày nhận các phiên; null = bỏ các phiên khỏi lịch. */
  onRemove: (to: string | null) => void;
  onToggleMeetingOnly: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'move' | 'remove'>('view');
  const [draft, setDraft] = useState(day.date);
  const [target, setTarget] = useState('');

  const count = usage?.count ?? 0;
  const meetings = [
    usage?.kinds.has('OPENING') && KIND_LABELS.OPENING,
    usage?.kinds.has('CLOSING') && KIND_LABELS.CLOSING,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-56 shrink-0">
          <strong className="text-slate-700">Ngày {index + 1}</strong>
          <span className="ml-1.5 text-slate-500">{formatDayLong(day.date)}</span>
        </span>

        <span className="text-xs font-medium text-slate-600">Sáng</span>
        <TimeInput value={day.amStart} disabled={locked} onChange={(v) => onPatch({ amStart: v })} onCommit={onCommit} />
        <span className="text-slate-400">–</span>
        <TimeInput value={day.amEnd} disabled={locked} onChange={(v) => onPatch({ amEnd: v })} onCommit={onCommit} />

        <span className="ml-3 text-xs font-medium text-slate-600">Chiều</span>
        <TimeInput value={day.pmStart} disabled={locked} onChange={(v) => onPatch({ pmStart: v })} onCommit={onCommit} />
        <span className="text-slate-400">–</span>
        <TimeInput value={day.pmEnd} disabled={locked} onChange={(v) => onPatch({ pmEnd: v })} onCommit={onCommit} />

        {!locked && showApplyAll && (
          <button onClick={onApplyAll} className="ml-2 text-xs text-brand-700 hover:underline">
            Áp dụng cho mọi ngày
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 sm:pl-[14.5rem]">
        <span>{count > 0 ? `${count} phiên` : 'Chưa có phiên'}</span>
        {meetings.map((m) => (
          <span key={m} className="chip bg-brand-50 text-brand-700 ring-transparent">{m}</span>
        ))}

        <label
          className="flex cursor-pointer items-center gap-1.5"
          title="Ngày chỉ có cuộc họp: không tính vào quỹ thời gian và không xếp đơn vị khi tính lịch tự động"
        >
          <input
            type="checkbox"
            checked={Boolean(day.meetingOnly)}
            disabled={locked}
            onChange={onToggleMeetingOnly}
            className="h-3.5 w-3.5 accent-brand-600"
          />
          Chỉ họp
        </label>

        {!locked && mode === 'view' && (
          <>
            <button
              onClick={() => {
                setDraft(day.date);
                setMode('move');
              }}
              className="text-brand-700 hover:underline"
            >
              Đổi ngày
            </button>
            {canRemove && (
              <button
                onClick={() => {
                  if (count === 0) return onRemove(null);
                  setTarget('');
                  setMode('remove');
                }}
                className="text-red-600 hover:underline"
              >
                Xoá ngày
              </button>
            )}
          </>
        )}
      </div>

      {mode === 'move' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:ml-[14.5rem]">
          <span className="text-slate-600">Chuyển sang ngày</span>
          <input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            onClick={() => onMove(draft) && setMode('view')}
            disabled={!isValidDay(draft) || draft === day.date}
            className="btn-primary !px-3 !py-1 text-sm"
          >
            Đổi
          </button>
          <button onClick={() => setMode('view')} className="btn-ghost !px-3 !py-1 text-sm">
            Huỷ
          </button>
          {count > 0 && (
            <span className="w-full text-xs text-slate-500">
              {count} phiên trên ngày này đi theo, giữ nguyên giờ.
            </span>
          )}
        </div>
      )}

      {mode === 'remove' && (
        <div className="space-y-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 sm:ml-[14.5rem]">
          <p>
            Ngày này đang có <strong>{count} phiên</strong>
            {meetings.length > 0 && <> (gồm {meetings.join(', ').toLowerCase()})</>}. Các phiên đó sẽ:
          </p>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="">Bỏ khỏi lịch — đơn vị về lại kho, xếp lại sau</option>
            {otherDays.map((x) => (
              <option key={x} value={x}>
                Chuyển sang {formatDayLong(x)}, giữ nguyên giờ
              </option>
            ))}
          </select>
          {target && (
            <p className="text-xs">
              Nếu ngày nhận đã có phiên cùng giờ, lịch sẽ báo trùng để bạn chỉnh lại.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                onRemove(target || null);
                setMode('view');
              }}
              className="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
            >
              Xoá ngày
            </button>
            <button onClick={() => setMode('view')} className="btn-ghost !px-3 !py-1 text-sm">
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Thêm một ngày bất kỳ — không cần liền với các ngày đã có. */
function AddDayRow({
  suggest, onAdd,
}: {
  /** Gọi lúc mở ô để lấy ngày gợi ý mới nhất. */
  suggest: () => string;
  onAdd: (date: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => {
          setDraft(suggest());
          setOpen(true);
        }}
        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left text-sm text-slate-500 hover:border-brand-400 hover:text-brand-700"
      >
        + Thêm ngày thực hiện
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-brand-300 px-3 py-2 text-sm">
      <span className="text-slate-600">Thêm ngày</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
      />
      <button
        onClick={() => onAdd(draft) && setOpen(false)}
        disabled={!isValidDay(draft)}
        className="btn-primary !px-3 !py-1 text-sm"
      >
        Thêm
      </button>
      <button onClick={() => setOpen(false)} className="btn-ghost !px-3 !py-1 text-sm">
        Huỷ
      </button>
      <span className="w-full text-xs text-slate-500">
        Khung giờ lấy theo ngày liền trước, sửa lại được. Ngày mới chưa có phiên — kéo đơn vị từ
        kho xuống lưới để xếp.
      </span>
    </div>
  );
}

function TimeInput({
  value, onChange, onCommit, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Gọi khi rời khỏi ô — lúc đó giá trị mới thật sự là ý của người dùng. */
  onCommit: () => void;
  disabled: boolean;
}) {
  return (
    <input
      type="time"
      step={300} // bước 5 phút, cùng nhịp với thao tác kéo trên lưới
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
