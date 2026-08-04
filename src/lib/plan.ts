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
/* Sinh lịch tự động                                                   */
/* ------------------------------------------------------------------ */

type Window = { day: string; start: number; end: number };

export type GenerateResult = {
  sessions: Omit<PlanSession, 'id'>[];
  /** Thời lượng mỗi phiên đánh giá đơn vị, tính bằng phút. */
  perMinutes: number;
  /** Đã chạm sàn MIN_SESSION — quỹ thời gian không đủ cho khối lượng phân công. */
  atFloor: boolean;
  /** Đơn vị không xếp được vào đâu. */
  unplacedUnitIds: string[];
};

/**
 * Chia đều thời gian cho các đơn vị.
 *
 * Ý chính: thời lượng mỗi phiên KHÔNG phụ thuộc số đơn vị mà phụ thuộc người
 * bận nhất. Nhiều đơn vị chạy song song được, nhưng một người ôm K đơn vị thì
 * K phiên đó buộc phải nối tiếp — người đó là đường găng của cả lịch.
 *
 *   1. Quỹ thời gian = tổng giờ làm việc − họp khai mạc − họp kết thúc
 *   2. K = số đơn vị lớn nhất mà một đánh giá viên phải phụ trách
 *   3. Thời lượng mỗi phiên = quỹ ÷ K, làm tròn XUỐNG bội số 15 phút
 *      (làm tròn xuống để chắc chắn không tràn khỏi giờ làm việc)
 *   4. Xếp chỗ: đơn vị nhiều người phụ trách xếp trước, mỗi đơn vị nhận mốc
 *      15 phút sớm nhất mà mọi người phụ trách đều rảnh và phiên nằm TRỌN
 *      trong một buổi — không cắt ngang nghỉ trưa, không tràn sang ngày sau
 *   5. Khai mạc đặt đầu ngày đầu, kết thúc đặt sát giờ tan ca ngày cuối,
 *      cả đoàn dự nên hai khung này chặn lịch của mọi người
 */
export function generateTimedPlan(input: {
  days: string[];
  amStart: string;
  amEnd: string;
  pmStart: string;
  pmEnd: string;
  openingMinutes: number;
  closingMinutes: number;
  units: { id: string }[];
  unitMembers: Map<string, string[]>;
  allMemberIds: string[];
}): GenerateResult {
  const {
    days, amStart, amEnd, pmStart, pmEnd, openingMinutes, closingMinutes,
    units, unitMembers, allMemberIds,
  } = input;

  const empty: GenerateResult = {
    sessions: [], perMinutes: 0, atFloor: false, unplacedUnitIds: units.map((u) => u.id),
  };
  if (days.length === 0 || units.length === 0) return empty;

  const am = { s: toMinutes(amStart), e: toMinutes(amEnd) };
  const pm = { s: toMinutes(pmStart), e: toMinutes(pmEnd) };
  if (am.e <= am.s || pm.e <= pm.s) return empty;

  const lastDay = days[days.length - 1];
  const out: Omit<PlanSession, 'id'>[] = [];

  /* --- Hai cuộc họp cố định --- */
  const openEnd = ceilStep(am.s + openingMinutes);
  out.push({
    day: days[0], startTime: toHHMM(am.s), endTime: toHHMM(openEnd),
    kind: 'OPENING', unitId: null, note: null,
  });

  const closeStart = floorStep(pm.e - closingMinutes);
  out.push({
    day: lastDay, startTime: toHHMM(closeStart), endTime: toHHMM(pm.e),
    kind: 'CLOSING', unitId: null, note: null,
  });

  /* --- Các khung giờ còn trống để xếp đơn vị --- */
  const windows: Window[] = [];
  for (const day of days) {
    const morningStart = day === days[0] ? openEnd : am.s;
    if (am.e > morningStart) windows.push({ day, start: morningStart, end: am.e });

    const afternoonEnd = day === lastDay ? closeStart : pm.e;
    if (afternoonEnd > pm.s) windows.push({ day, start: pm.s, end: afternoonEnd });
  }

  const available = windows.reduce((sum, w) => sum + (w.end - w.start), 0);

  /* --- Người bận nhất quyết định thời lượng --- */
  const loadByMember = new Map<string, number>();
  for (const u of units) {
    for (const m of unitMembers.get(u.id) ?? []) {
      loadByMember.set(m, (loadByMember.get(m) ?? 0) + 1);
    }
  }
  const K = Math.max(1, ...loadByMember.values());

  const raw = floorStep(available / K);
  const atFloor = raw < MIN_SESSION;
  const perMinutes = Math.max(MIN_SESSION, raw);

  /* --- Xếp chỗ: đơn vị nhiều người phụ trách trước --- */
  const placed: { day: string; start: number; end: number; members: string[] }[] = [
    { day: days[0], start: am.s, end: openEnd, members: allMemberIds },
    { day: lastDay, start: closeStart, end: pm.e, members: allMemberIds },
  ];

  const free = (day: string, start: number, end: number, ms: string[]) =>
    !placed.some(
      (p) =>
        p.day === day && start < p.end && p.start < end && p.members.some((x) => ms.includes(x)),
    );

  const sorted = [...units].sort(
    (a, b) => (unitMembers.get(b.id)?.length ?? 0) - (unitMembers.get(a.id)?.length ?? 0),
  );

  const unplacedUnitIds: string[] = [];

  for (const unit of sorted) {
    const ms = unitMembers.get(unit.id) ?? [];
    if (ms.length === 0) {
      unplacedUnitIds.push(unit.id);
      continue;
    }

    let done = false;
    for (const w of windows) {
      // Chỉ thử các mốc 15 phút nằm trọn trong khung này.
      for (let t = ceilStep(w.start); t + perMinutes <= w.end; t += STEP) {
        if (!free(w.day, t, t + perMinutes, ms)) continue;
        placed.push({ day: w.day, start: t, end: t + perMinutes, members: ms });
        out.push({
          day: w.day, startTime: toHHMM(t), endTime: toHHMM(t + perMinutes),
          kind: 'UNIT', unitId: unit.id, note: null,
        });
        done = true;
        break;
      }
      if (done) break;
    }

    // Không tìm được chỗ nào — vẫn báo ra để trưởng đoàn tự sắp, không giấu đi.
    if (!done) unplacedUnitIds.push(unit.id);
  }

  const dayIndex = new Map(days.map((d, i) => [d, i]));
  out.sort(
    (a, b) =>
      (dayIndex.get(a.day) ?? 0) - (dayIndex.get(b.day) ?? 0) ||
      toMinutes(a.startTime) - toMinutes(b.startTime),
  );

  return { sessions: out, perMinutes, atFloor, unplacedUnitIds };
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
