import { STANDARD_SHORT, type StandardCode } from './iso';

/**
 * Tiện ích cho chương trình đánh giá. File này KHÔNG nhập gì từ phía máy chủ
 * (không `auth`, không `db`) để component trình duyệt dùng chung được.
 */

export type SessionKind = 'OPENING' | 'UNIT' | 'INTERNAL' | 'CLOSING';

export const KIND_LABELS: Record<SessionKind, string> = {
  OPENING: 'Họp khai mạc',
  UNIT: 'Đánh giá đơn vị',
  INTERNAL: 'Họp đoàn đánh giá',
  CLOSING: 'Họp kết thúc',
};

export type PlanSession = {
  id: string;
  day: string;        // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  kind: SessionKind;
  unitId: string | null;
  note: string | null;
};

/** Bước làm tròn mọi mốc giờ khi sinh lịch tự động. */
export const STEP = 15;
/** Sàn thời lượng một phiên. Chạm sàn thì báo là không đủ thời gian. */
export const MIN_SESSION = 60;

/* ------------------------------------------------------------------ */
/* Giờ                                                                 */
/* ------------------------------------------------------------------ */

/** "08:30" → 510 phút kể từ nửa đêm. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 510 → "08:30" */
export function toHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Làm tròn LÊN mốc 15 phút gần nhất. */
const ceilStep = (m: number) => Math.ceil(m / STEP) * STEP;
/** Làm tròn XUỐNG mốc 15 phút gần nhất. */
const floorStep = (m: number) => Math.floor(m / STEP) * STEP;

export function durationLabel(startTime: string, endTime: string) {
  const mins = toMinutes(endTime) - toMinutes(startTime);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}` : `${h}h`) : `${m} phút`;
}

/* ------------------------------------------------------------------ */
/* Ngày                                                                */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "2026-08-05" → "Thứ Tư, 05/08/2026" */
export function formatDayLong(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function toDayString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Danh sách ngày từ đầu tới cuối đợt, bao gồm cả hai đầu. */
export function listDays(start: Date | string | null, end: Date | string | null): string[] {
  if (!start || !end) return [];
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = typeof end === 'string' ? new Date(end) : end;

  const days: string[] = [];
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());

  // Chặn 60 ngày phòng dữ liệu ngày tháng bị nhập sai.
  while (cur <= last && days.length < 60) {
    days.push(toDayString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/* ------------------------------------------------------------------ */
/* Xung đột                                                            */
/* ------------------------------------------------------------------ */

/** Ai tham gia phiên này: đơn vị thì lấy người được phân công, họp thì cả đoàn. */
export function sessionMembers(
  s: Pick<PlanSession, 'kind' | 'unitId'>,
  unitMembers: Map<string, string[]>,
  allMemberIds: string[],
): string[] {
  if (s.kind === 'UNIT') return s.unitId ? unitMembers.get(s.unitId) ?? [] : [];
  return allMemberIds; // khai mạc, kết thúc, họp đoàn — cả đoàn dự
}

const overlaps = (a: PlanSession, b: PlanSession) =>
  a.day === b.day &&
  toMinutes(a.startTime) < toMinutes(b.endTime) &&
  toMinutes(b.startTime) < toMinutes(a.endTime);

/**
 * Tìm các phiên bị trùng: giao nhau về thời gian VÀ có chung ít nhất một
 * đánh giá viên. Trả về id các phiên có vấn đề, kèm mô tả để hiện cảnh báo.
 */
export function findTimeConflicts(
  sessions: PlanSession[],
  unitMembers: Map<string, string[]>,
  members: { id: string; fullName: string }[],
): { ids: Set<string>; messages: string[] } {
  const allIds = members.map((m) => m.id);
  const nameById = new Map(members.map((m) => [m.id, m.fullName]));

  const ids = new Set<string>();
  const messages: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (!overlaps(a, b)) continue;

      const ma = new Set(sessionMembers(a, unitMembers, allIds));
      const shared = sessionMembers(b, unitMembers, allIds).filter((m) => ma.has(m));
      if (shared.length === 0) continue;

      ids.add(a.id);
      ids.add(b.id);
      messages.push(
        `${shared.map((m) => nameById.get(m) ?? '?').join(', ')} bị xếp trùng giờ ` +
          `${a.startTime}–${a.endTime} và ${b.startTime}–${b.endTime} ngày ${formatDayLong(a.day)}`,
      );
    }
  }

  return { ids, messages: [...new Set(messages)] };
}

/**
 * Phiên có nằm trọn trong một khung giờ làm việc không.
 *
 * Lịch sinh tự động luôn thoả điều kiện này, nhưng khi trưởng đoàn sửa tay thì
 * có thể tạo ra phiên ôm trọn giờ nghỉ trưa hoặc tràn ra ngoài giờ tan ca.
 * Trả về mô tả lỗi, hoặc null nếu hợp lệ.
 */
export function checkWorkingHours(
  s: Pick<PlanSession, 'startTime' | 'endTime'>,
  hours: { amStart: string; amEnd: string; pmStart: string; pmEnd: string },
): string | null {
  const a = toMinutes(s.startTime);
  const b = toMinutes(s.endTime);
  if (b <= a) return 'Giờ kết thúc phải sau giờ bắt đầu';

  const inAm = a >= toMinutes(hours.amStart) && b <= toMinutes(hours.amEnd);
  const inPm = a >= toMinutes(hours.pmStart) && b <= toMinutes(hours.pmEnd);
  if (inAm || inPm) return null;

  // Bắt đầu trong buổi sáng nhưng kết thúc sau giờ nghỉ → ôm trọn giờ trưa.
  if (a < toMinutes(hours.amEnd) && b > toMinutes(hours.pmStart)) {
    return 'Phiên vắt qua giờ nghỉ trưa';
  }
  return `Nằm ngoài giờ làm việc (${hours.amStart}–${hours.amEnd}, ${hours.pmStart}–${hours.pmEnd})`;
}

/* ------------------------------------------------------------------ */
/* Quỹ thời gian                                                       */
/* ------------------------------------------------------------------ */

export type Hours = {
  amStart: string; amEnd: string; pmStart: string; pmEnd: string;
  openingMinutes: number; closingMinutes: number;
};

type Window = { day: string; start: number; end: number };

/**
 * Các khung giờ còn trống để xếp đơn vị, sau khi đã trừ họp khai mạc (đầu ngày
 * đầu) và họp kết thúc (cuối ngày cuối).
 */
export function buildWindows(days: string[], h: Hours): Window[] {
  if (days.length === 0) return [];

  const am = { s: toMinutes(h.amStart), e: toMinutes(h.amEnd) };
  const pm = { s: toMinutes(h.pmStart), e: toMinutes(h.pmEnd) };
  if (am.e <= am.s || pm.e <= pm.s) return [];

  const lastDay = days[days.length - 1];
  const openEnd = ceilStep(am.s + h.openingMinutes);
  const closeStart = floorStep(pm.e - h.closingMinutes);

  const windows: Window[] = [];
  for (const day of days) {
    const mStart = day === days[0] ? openEnd : am.s;
    if (am.e > mStart) windows.push({ day, start: mStart, end: am.e });

    const aEnd = day === lastDay ? closeStart : pm.e;
    if (aEnd > pm.s) windows.push({ day, start: pm.s, end: aEnd });
  }
  return windows;
}

export type Capacity = {
  /** Tổng phút ĐỒNG HỒ còn lại để đánh giá đơn vị. */
  availableMinutes: number;
  /**
   * SEQUENTIAL — chưa phân công ai, cả đoàn đi cùng nhau, chia cho số đơn vị.
   * PARALLEL   — đã phân công, chia cho số vòng của người bận nhất.
   */
  mode: 'SEQUENTIAL' | 'PARALLEL';
  /** Số lần chia: số đơn vị, hoặc số vòng của người bận nhất. */
  divisor: number;
  /** Thời lượng trung bình mỗi đơn vị, phút. */
  perUnitMinutes: number;
  /** Dưới sàn MIN_SESSION — quỹ thời gian không đủ. */
  atFloor: boolean;
  unitCount: number;
  dayCount: number;
};

/**
 * Tính quỹ thời gian và thời lượng trung bình mỗi đơn vị.
 *
 * Chia theo thời gian ĐỒNG HỒ, không phải công sức: một buổi làm việc với đơn
 * vị mất bấy nhiêu thời gian bất kể có 1 hay 4 đánh giá viên ngồi trong phòng.
 *
 * Chỗ khác nhau giữa hai chế độ nằm ở số chia:
 *  - Chưa phân công: cả đoàn đi cùng nhau nên mỗi đơn vị chiếm trọn một khoảng
 *    thời gian → chia cho SỐ ĐƠN VỊ.
 *  - Đã phân công: nhiều đơn vị chạy song song, nhưng người ôm K đơn vị thì K
 *    phiên đó buộc nối tiếp → chia cho K, tức SỐ VÒNG CỦA NGƯỜI BẬN NHẤT.
 *    Con số ra lớn hơn hẳn — đó chính là lợi ích của việc phân công.
 */
export function computeCapacity(input: {
  days: string[];
  hours: Hours;
  units: { id: string }[];
  unitMembers: Map<string, string[]>;
}): Capacity {
  const { days, hours, units, unitMembers } = input;

  const windows = buildWindows(days, hours);
  const availableMinutes = windows.reduce((sum, w) => sum + (w.end - w.start), 0);

  const load = new Map<string, number>();
  for (const u of units) {
    for (const m of unitMembers.get(u.id) ?? []) load.set(m, (load.get(m) ?? 0) + 1);
  }

  const mode: Capacity['mode'] = load.size === 0 ? 'SEQUENTIAL' : 'PARALLEL';
  const divisor =
    units.length === 0 ? 0 : mode === 'SEQUENTIAL' ? units.length : Math.max(...load.values());

  const raw = divisor > 0 ? floorStep(availableMinutes / divisor) : 0;

  return {
    availableMinutes,
    mode,
    divisor,
    perUnitMinutes: Math.max(0, raw),
    atFloor: divisor > 0 && raw < MIN_SESSION,
    unitCount: units.length,
    dayCount: days.length,
  };
}

/* ------------------------------------------------------------------ */
/* Sinh lịch tự động                                                   */
/* ------------------------------------------------------------------ */

export type GenerateResult = {
  sessions: Omit<PlanSession, 'id'>[];
  capacity: Capacity;
  /** Đơn vị không xếp được vào đâu. */
  unplacedUnitIds: string[];
};

/** Chia N phần vào các khung theo tỉ lệ độ dài, dùng phương pháp phần dư lớn nhất. */
function shareOut(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const base = exact.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);

  // Phần dư rơi vào các khung có phần thập phân lớn nhất.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { i } of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

export function generateTimedPlan(input: {
  days: string[];
  hours: Hours;
  units: { id: string }[];
  unitMembers: Map<string, string[]>;
  allMemberIds: string[];
}): GenerateResult {
  const { days, hours, units, unitMembers, allMemberIds } = input;

  const capacity = computeCapacity({ days, hours, units, unitMembers });
  const windows = buildWindows(days, hours);

  if (days.length === 0 || windows.length === 0) {
    return { sessions: [], capacity, unplacedUnitIds: units.map((u) => u.id) };
  }

  const am = { s: toMinutes(hours.amStart) };
  const pm = { e: toMinutes(hours.pmEnd) };
  const lastDay = days[days.length - 1];

  const out: Omit<PlanSession, 'id'>[] = [
    {
      day: days[0],
      startTime: toHHMM(am.s),
      endTime: toHHMM(ceilStep(am.s + hours.openingMinutes)),
      kind: 'OPENING', unitId: null, note: null,
    },
    {
      day: lastDay,
      startTime: toHHMM(floorStep(pm.e - hours.closingMinutes)),
      endTime: toHHMM(pm.e),
      kind: 'CLOSING', unitId: null, note: null,
    },
  ];

  const unplacedUnitIds: string[] = [];

  if (capacity.mode === 'SEQUENTIAL') {
    /* --------- Cả đoàn đi cùng nhau: lấp kín từng buổi theo thứ tự --------- */
    const counts = shareOut(units.length, windows.map((w) => w.end - w.start));
    let idx = 0;

    windows.forEach((w, wi) => {
      const n = counts[wi];
      if (n <= 0) return;

      const span = w.end - w.start;
      const base = floorStep(span / n);
      // Phần dư chia thành các khối 15 phút, cộng vào những đơn vị đầu buổi.
      const extras = Math.floor((span - base * n) / STEP);

      let t = w.start;
      for (let k = 0; k < n && idx < units.length; k++, idx++) {
        const dur = base + (k < extras ? STEP : 0);
        if (dur <= 0) {
          unplacedUnitIds.push(units[idx].id);
          continue;
        }
        out.push({
          day: w.day,
          startTime: toHHMM(t),
          endTime: toHHMM(Math.min(t + dur, w.end)),
          kind: 'UNIT', unitId: units[idx].id, note: null,
        });
        t += dur;
      }
    });

    for (; idx < units.length; idx++) unplacedUnitIds.push(units[idx].id);
  } else {
    /* --------- Đã phân công: xếp song song, tránh trùng người --------- */
    const per = Math.max(MIN_SESSION, capacity.perUnitMinutes);

    const placed: { day: string; start: number; end: number; members: string[] }[] = [
      { day: days[0], start: am.s, end: ceilStep(am.s + hours.openingMinutes), members: allMemberIds },
      { day: lastDay, start: floorStep(pm.e - hours.closingMinutes), end: pm.e, members: allMemberIds },
    ];

    const free = (day: string, a: number, b: number, ms: string[]) =>
      !placed.some(
        (x) => x.day === day && a < x.end && x.start < b && x.members.some((y) => ms.includes(y)),
      );

    // Đơn vị nhiều người phụ trách xếp trước — càng dễ đụng lịch người khác thì
    // càng phải chọn chỗ khi còn nhiều ô trống. Thứ tự khai báo giữ làm tiêu chí phụ.
    const order = units
      .map((u, i) => ({ u, i }))
      .sort(
        (a, b) =>
          (unitMembers.get(b.u.id)?.length ?? 0) - (unitMembers.get(a.u.id)?.length ?? 0) ||
          a.i - b.i,
      );

    for (const { u } of order) {
      // Đơn vị chưa phân công ai vẫn phải có chỗ trong lịch — trước đây bị bỏ qua
      // im lặng khiến trưởng đoàn mở tab ra thấy lịch trống trơn.
      const ms = unitMembers.get(u.id) ?? [];

      let done = false;
      for (const w of windows) {
        for (let t = ceilStep(w.start); t + per <= w.end; t += STEP) {
          if (ms.length > 0 && !free(w.day, t, t + per, ms)) continue;
          placed.push({ day: w.day, start: t, end: t + per, members: ms });
          out.push({
            day: w.day, startTime: toHHMM(t), endTime: toHHMM(t + per),
            kind: 'UNIT', unitId: u.id, note: null,
          });
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) unplacedUnitIds.push(u.id);
    }
  }

  const dayIndex = new Map(days.map((d, i) => [d, i]));
  out.sort(
    (a, b) =>
      (dayIndex.get(a.day) ?? 0) - (dayIndex.get(b.day) ?? 0) ||
      toMinutes(a.startTime) - toMinutes(b.startTime),
  );

  return { sessions: out, capacity, unplacedUnitIds };
}

/* ------------------------------------------------------------------ */
/* Nội dung điền sẵn                                                   */
/* ------------------------------------------------------------------ */

/** Ba mục tiêu chuẩn theo ISO 19011 — dùng được cho hầu hết đợt đánh giá nội bộ. */
export function defaultObjectives() {
  return [
    'Xác định mức độ phù hợp của hệ thống quản lý với các chuẩn mực đánh giá.',
    'Đánh giá hiệu lực của hệ thống quản lý trong việc đạt được các mục tiêu đã định.',
    'Xác định các cơ hội cải tiến hệ thống quản lý.',
  ].join('\n');
}

/** Chuẩn mực ghép từ tiêu chuẩn đã chọn cho đợt, cộng dòng về tài liệu nội bộ. */
export function defaultCriteria(standards: string[]) {
  const names = standards
    .map((s) => STANDARD_SHORT[s as StandardCode])
    .filter(Boolean)
    .join('; ');
  return [
    names ? `Các tiêu chuẩn: ${names}.` : '',
    'Sổ tay hệ thống quản lý, các thủ tục, quy trình và hướng dẫn công việc hiện hành của tổ chức.',
    'Các yêu cầu pháp luật và yêu cầu khác mà tổ chức phải tuân thủ.',
  ]
    .filter(Boolean)
    .join('\n');
}
