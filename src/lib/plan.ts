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
/** Thời lượng tối thiểu nên có cho một phiên đơn vị khi tự xếp. */
const MIN_SESSION = 60;
/** Trần một phiên tự xếp khi đã phân công — nửa ngày, để lịch không bị một đơn vị ôm trọn ngày. */
const MAX_SESSION = 240;

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

/** "2026-10-22" → "22/10/2026" */
export function formatDayShort(day: string) {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

const nextDayString = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return toDayString(new Date(y, m - 1, d + 1));
};

/**
 * Danh sách ngày rời rạc → chữ gọn để in.
 *
 * Ngày liền nhau gộp thành một khoảng. Cùng năm thì năm chỉ ghi một lần ở cuối:
 *   ["2026-10-22","2026-10-24","2026-10-25","2026-10-30"]
 *   → "22/10, 24/10 – 25/10, 30/10/2026"
 */
export function formatDayList(days: string[]): string {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 0) return '';

  const runs: [string, string][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && nextDayString(last[1]) === d) last[1] = d;
    else runs.push([d, d]);
  }

  const sameYear = sorted[0].slice(0, 4) === sorted[sorted.length - 1].slice(0, 4);
  const fmt = (d: string) => (sameYear ? formatDayShort(d).slice(0, 5) : formatDayShort(d));
  const text = runs.map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`)).join(', ');
  return sameYear ? `${text}/${sorted[0].slice(0, 4)}` : text;
}

/** Danh sách ngày từ đầu tới cuối khoảng, bao gồm cả hai đầu. */
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

/** Một khoảng giờ làm việc trong ngày, "HH:MM". */
export type TimeRange = { start: string; end: string };

/**
 * Một ngày thực hiện: ngày dương lịch cụ thể và MỘT HOẶC NHIỀU khoảng giờ làm
 * việc — 08:00–11:00 và 14:00–17:00, hoặc chỉ 08:00–09:00 cho ngày khai mạc.
 * Giữa hai khoảng là giờ nghỉ, không xếp phiên vào.
 */
export type AuditDay = {
  date: string; // "YYYY-MM-DD"
  /** Đã sắp xếp theo giờ, không chồng nhau, ít nhất một khoảng. */
  ranges: TimeRange[];
};

/** Khoảng giờ mặc định cho ngày mới: sáng và chiều. */
export const DEFAULT_RANGES: TimeRange[] = [
  { start: '08:00', end: '11:30' },
  { start: '13:30', end: '17:00' },
];

/** Giờ bắt đầu sớm nhất / kết thúc muộn nhất của một ngày. */
export const dayStart = (d: AuditDay) => d.ranges[0]?.start ?? DEFAULT_RANGES[0].start;
export const dayEnd = (d: AuditDay) => d.ranges[d.ranges.length - 1]?.end ?? DEFAULT_RANGES[1].end;

/** "08:00–11:00, 14:00–17:00" */
export const formatRanges = (ranges: TimeRange[]) => ranges.map((r) => `${r.start}–${r.end}`).join(', ');

export const sortRanges = (ranges: TimeRange[]) =>
  [...ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

/** Lỗi của danh sách khoảng giờ một ngày, hoặc null nếu hợp lệ. */
export function rangesProblem(ranges: TimeRange[]): string | null {
  if (ranges.length === 0) return 'chưa có khoảng giờ nào';
  const sorted = sortRanges(ranges);
  for (const r of sorted) {
    if (toMinutes(r.end) <= toMinutes(r.start)) return `khoảng ${r.start}–${r.end} có giờ kết thúc không sau giờ bắt đầu`;
  }
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
      return `khoảng ${sorted[i - 1].start}–${sorted[i - 1].end} và ${sorted[i].start}–${sorted[i].end} chồng nhau`;
    }
  }
  return null;
}

/**
 * Một ngày như đang nằm trong database. Đọc được mọi dạng đã từng ghi:
 *  - hiện tại: `ranges`,
 *  - bản trước: một khoảng `start` / `end`,
 *  - bản đầu của migration 014: bốn mốc sáng / chiều.
 */
export type StoredAuditDay = {
  date: string;
  ranges?: TimeRange[];
  start?: string;
  end?: string;
  amStart?: string;
  amEnd?: string;
  pmStart?: string;
  pmEnd?: string;
};

/** Bốn mốc sáng/chiều → hai khoảng; sáng và chiều liền nhau thì gộp làm một. */
function fromHalves(h: { amStart: string; amEnd: string; pmStart: string; pmEnd: string }): TimeRange[] {
  if (toMinutes(h.pmStart) <= toMinutes(h.amEnd)) return [{ start: h.amStart, end: h.pmEnd }];
  return [
    { start: h.amStart, end: h.amEnd },
    { start: h.pmStart, end: h.pmEnd },
  ];
}

/**
 * Ngày thực hiện của một đợt, đã sắp xếp và đã quy về dạng danh sách khoảng giờ.
 *
 * Đợt nào chưa có danh sách ngày (tạo xong chưa mở tab Chương trình) thì suy ra
 * từ khoảng start → end, giờ lấy theo giờ sáng / chiều mặc định của đợt.
 */
export function resolveAuditDays(audit: {
  auditDays?: StoredAuditDay[] | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  dayHours?: { amStart: string; amEnd: string; pmStart: string; pmEnd: string }[] | null;
  amStart?: string | null;
  amEnd?: string | null;
  pmStart?: string | null;
  pmEnd?: string | null;
}): AuditDay[] {
  const defaults = {
    amStart: audit.amStart || DEFAULT_RANGES[0].start,
    amEnd: audit.amEnd || DEFAULT_RANGES[0].end,
    pmStart: audit.pmStart || DEFAULT_RANGES[1].start,
    pmEnd: audit.pmEnd || DEFAULT_RANGES[1].end,
  };

  if (audit.auditDays && audit.auditDays.length > 0) {
    return audit.auditDays
      .map((d): AuditDay => {
        if (d.ranges && d.ranges.length > 0) return { date: d.date, ranges: sortRanges(d.ranges) };
        if (d.start && d.end) return { date: d.date, ranges: [{ start: d.start, end: d.end }] };
        return {
          date: d.date,
          ranges: fromHalves({
            amStart: d.amStart ?? defaults.amStart,
            amEnd: d.amEnd ?? defaults.amEnd,
            pmStart: d.pmStart ?? defaults.pmStart,
            pmEnd: d.pmEnd ?? defaults.pmEnd,
          }),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return listDays(audit.startDate, audit.endDate).map((date, i) => ({
    date,
    ranges: fromHalves(audit.dayHours?.[i] ?? defaults),
  }));
}

/* ------------------------------------------------------------------ */
/* Người tham gia                                                      */
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

const isMeeting = (k: SessionKind) => k !== 'UNIT';

/** Sắp theo ngày rồi theo giờ bắt đầu; họp khai mạc luôn trước, họp kết thúc luôn sau nếu trùng mốc. */
export function sortSessions<T extends Pick<PlanSession, 'day' | 'startTime' | 'kind'>>(list: T[]): T[] {
  const rank = (k: SessionKind) => (k === 'OPENING' ? 0 : k === 'CLOSING' ? 2 : 1);
  return [...list].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      rank(a.kind) - rank(b.kind) ||
      toMinutes(a.startTime) - toMinutes(b.startTime),
  );
}

/* ------------------------------------------------------------------ */
/* Hai cuộc họp cố định                                                */
/* ------------------------------------------------------------------ */

/**
 * Ghim họp khai mạc vào ĐẦU ngày đầu tiên và họp kết thúc vào CUỐI ngày cuối.
 *
 * Gọi sau mọi thao tác đụng tới ngày (thêm, đổi, xoá ngày, sửa giờ ngày) và
 * sau khi sửa thời lượng cuộc họp. Nhờ vậy lịch không bao giờ thiếu hai cuộc
 * họp này và chúng không bao giờ nằm sai chỗ — không cần ai nhớ dời chúng.
 *
 * Giữ nguyên thời lượng của cuộc họp đang có; chưa có thì tạo mới với thời
 * lượng mặc định. Dư (dữ liệu cũ có hai khai mạc) thì chỉ giữ cái đầu.
 */
export function pinMeetings(
  sessions: PlanSession[],
  days: AuditDay[],
  defaults: { openingMinutes: number; closingMinutes: number },
  makeId: () => string,
): PlanSession[] {
  if (days.length === 0) return sessions;
  const first = days[0];
  const last = days[days.length - 1];

  const op = sessions.find((s) => s.kind === 'OPENING');
  const cl = sessions.find((s) => s.kind === 'CLOSING');
  const rest = sessions.filter((s) => s.kind !== 'OPENING' && s.kind !== 'CLOSING');

  const len = (s: PlanSession | undefined, fallback: number) =>
    s ? Math.max(5, toMinutes(s.endTime) - toMinutes(s.startTime)) : fallback;

  // Khai mạc nằm trong khoảng giờ ĐẦU của ngày đầu, kết thúc nằm trong khoảng CUỐI của ngày cuối.
  const fr = first.ranges[0] ?? DEFAULT_RANGES[0];
  const lr = last.ranges[last.ranges.length - 1] ?? DEFAULT_RANGES[1];
  const fs = toMinutes(fr.start);
  const fe = toMinutes(fr.end);
  const opening: PlanSession = {
    id: op?.id ?? makeId(),
    note: op?.note ?? null,
    kind: 'OPENING',
    unitId: null,
    day: first.date,
    startTime: fr.start,
    endTime: toHHMM(Math.min(fs + len(op, defaults.openingMinutes), Math.max(fe, fs + 5))),
  };

  const ls = toMinutes(lr.start);
  const le = toMinutes(lr.end);
  const closing: PlanSession = {
    id: cl?.id ?? makeId(),
    note: cl?.note ?? null,
    kind: 'CLOSING',
    unitId: null,
    day: last.date,
    startTime: toHHMM(Math.max(le - len(cl, defaults.closingMinutes), Math.min(ls, le - 5))),
    endTime: lr.end,
  };

  return [opening, ...rest, closing];
}

/* ------------------------------------------------------------------ */
/* Kiểm tra lịch                                                       */
/* ------------------------------------------------------------------ */

export type PlanCheck = {
  /** Lỗi gắn với từng dòng lịch, để tô đỏ đúng dòng. */
  rowIssues: Map<string, string[]>;
  /** Lỗi chung của cả lịch. */
  general: string[];
  /** Đơn vị chưa có phiên nào. */
  missingUnits: { id: string; name: string }[];
  /** Số dòng vi phạm vị trí hai cuộc họp (đặt trước khai mạc / sau kết thúc). */
  orderProblems: number;
  /** Số dòng có lỗi giờ giấc hoặc trùng giờ. */
  timeProblems: number;
  ok: boolean;
};

/**
 * Các quy tắc bắt buộc của một chương trình đánh giá:
 *  - mọi đơn vị đều có ít nhất một phiên,
 *  - có đúng một họp khai mạc, là phiên đầu tiên của đợt (đầu ngày đầu),
 *  - có đúng một họp kết thúc, là phiên cuối cùng của đợt (cuối ngày cuối),
 *  - mọi phiên nằm trong giờ làm việc của ngày, không ai bị xếp trùng giờ.
 */
export function validatePlan(input: {
  days: AuditDay[];
  sessions: PlanSession[];
  units: { id: string; name: string }[];
  unitMembers: Map<string, string[]>;
  members: { id: string; fullName: string }[];
}): PlanCheck {
  const { days, sessions, units, unitMembers, members } = input;
  const rowIssues = new Map<string, string[]>();
  const general: string[] = [];
  const add = (id: string, msg: string) => rowIssues.set(id, [...(rowIssues.get(id) ?? []), msg]);
  const orderRows = new Set<string>();
  const timeRows = new Set<string>();
  const addOrder = (id: string, msg: string) => {
    orderRows.add(id);
    add(id, msg);
  };
  const addTime = (id: string, msg: string) => {
    timeRows.add(id);
    add(id, msg);
  };

  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const allIds = members.map((m) => m.id);
  const nameById = new Map(members.map((m) => [m.id, m.fullName]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const label = (s: PlanSession) =>
    s.kind === 'UNIT' ? (s.unitId ? unitName.get(s.unitId) ?? 'Đơn vị' : 'Dòng chưa chọn đơn vị') : KIND_LABELS[s.kind];

  /* --- Hai cuộc họp --- */
  const openings = sessions.filter((s) => s.kind === 'OPENING');
  const closings = sessions.filter((s) => s.kind === 'CLOSING');
  if (openings.length === 0) general.push('Lịch chưa có họp khai mạc.');
  if (openings.length > 1) general.push('Lịch có nhiều hơn một họp khai mạc.');
  if (closings.length === 0) general.push('Lịch chưa có họp kết thúc.');
  if (closings.length > 1) general.push('Lịch có nhiều hơn một họp kết thúc.');

  const first = days[0];
  const last = days[days.length - 1];
  const op = openings[0];
  const cl = closings[0];
  if (op && first && op.day !== first.date) addOrder(op.id, 'Họp khai mạc phải ở ngày đầu tiên');
  if (cl && last && cl.day !== last.date) addOrder(cl.id, 'Họp kết thúc phải ở ngày cuối cùng');

  /* --- Từng dòng --- */
  for (const s of sessions) {
    const a = toMinutes(s.startTime);
    const b = toMinutes(s.endTime);
    const day = dayByDate.get(s.day);

    if (!day) addTime(s.id, 'Ngày này không còn trong danh sách ngày thực hiện');
    if (b <= a) addTime(s.id, 'Giờ kết thúc phải sau giờ bắt đầu');
    else if (day && !day.ranges.some((r) => a >= toMinutes(r.start) && b <= toMinutes(r.end))) {
      addTime(s.id, `Phải nằm trọn trong một khoảng giờ làm việc của ngày (${formatRanges(day.ranges)})`);
    }
    if (s.kind === 'UNIT' && !s.unitId) add(s.id, 'Chưa chọn đơn vị');

    if (s.kind !== 'OPENING' && op && s.day === op.day && a < toMinutes(op.endTime)) {
      addOrder(s.id, `Phải bắt đầu sau họp khai mạc (kết thúc ${op.endTime})`);
    }
    if (s.kind !== 'CLOSING' && cl && s.day === cl.day && b > toMinutes(cl.startTime)) {
      addOrder(s.id, `Phải kết thúc trước họp kết thúc (bắt đầu ${cl.startTime})`);
    }
  }

  /* --- Trùng giờ: chung đánh giá viên, hoặc cùng một đơn vị --- */
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const x = sessions[i];
      const y = sessions[j];
      if (x.day !== y.day) continue;
      if (!(toMinutes(x.startTime) < toMinutes(y.endTime) && toMinutes(y.startTime) < toMinutes(x.endTime))) {
        continue;
      }
      // Khai mạc / kết thúc đã có luật riêng ở trên, không báo trùng hai lần.
      if (x.kind === 'OPENING' || x.kind === 'CLOSING' || y.kind === 'OPENING' || y.kind === 'CLOSING') {
        continue;
      }

      if (x.kind === 'UNIT' && y.kind === 'UNIT' && x.unitId && x.unitId === y.unitId) {
        addTime(x.id, 'Trùng giờ với một phiên khác của chính đơn vị này');
        addTime(y.id, 'Trùng giờ với một phiên khác của chính đơn vị này');
        continue;
      }

      const mx = new Set(sessionMembers(x, unitMembers, allIds));
      const shared = sessionMembers(y, unitMembers, allIds).filter((m) => mx.has(m));
      if (shared.length === 0 && !(isMeeting(x.kind) || isMeeting(y.kind))) continue;

      const who = shared.map((m) => nameById.get(m) ?? '?').join(', ');
      const tail = who ? ` — ${who}` : '';
      addTime(x.id, `Trùng giờ với ${label(y)} ${y.startTime}–${y.endTime}${tail}`);
      addTime(y.id, `Trùng giờ với ${label(x)} ${x.startTime}–${x.endTime}${tail}`);
    }
  }

  /* --- Đơn vị nào cũng phải được đánh giá --- */
  const scheduled = new Set(sessions.filter((s) => s.kind === 'UNIT' && s.unitId).map((s) => s.unitId!));
  const missing = units.filter((u) => !scheduled.has(u.id));
  if (missing.length > 0) {
    general.push(`Chưa xếp lịch cho: ${missing.map((u) => u.name).join(', ')}.`);
  }

  return {
    rowIssues,
    general,
    missingUnits: missing,
    orderProblems: orderRows.size,
    timeProblems: timeRows.size,
    ok: rowIssues.size === 0 && general.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Tự xếp lịch                                                         */
/* ------------------------------------------------------------------ */

type Window = { day: string; start: number; end: number };

/** Chia N phần vào các khung theo tỉ lệ độ dài, dùng phương pháp phần dư lớn nhất. */
function shareOut(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const base = exact.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);

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

export type GenerateResult = {
  sessions: Omit<PlanSession, 'id'>[];
  /** Đơn vị không xếp được vào đâu — trưởng đoàn thêm tay. */
  unplacedUnitIds: string[];
};

/**
 * Dàn lịch tự động trong các ngày đã chọn.
 *
 * Khai mạc ở đầu ngày đầu, kết thúc ở cuối ngày cuối, đơn vị lấp phần giữa:
 *  - Chưa phân công ai: cả đoàn đi cùng nhau, các đơn vị nối tiếp nhau và chia
 *    đều toàn bộ thời gian còn lại.
 *  - Đã phân công: các đơn vị khác người phụ trách chạy song song, người ôm
 *    nhiều đơn vị thì các phiên của họ nối tiếp nhau, không ai bị trùng giờ.
 */
export function generatePlan(input: {
  days: AuditDay[];
  units: { id: string }[];
  unitMembers: Map<string, string[]>;
  allMemberIds: string[];
  openingMinutes: number;
  closingMinutes: number;
}): GenerateResult {
  const { days, units, unitMembers, allMemberIds, openingMinutes, closingMinutes } = input;
  if (days.length === 0) return { sessions: [], unplacedUnitIds: units.map((u) => u.id) };

  const first = days[0];
  const last = days[days.length - 1];

  const fr = first.ranges[0] ?? DEFAULT_RANGES[0];
  const lr = last.ranges[last.ranges.length - 1] ?? DEFAULT_RANGES[1];
  const opStart = toMinutes(fr.start);
  const opEnd = Math.min(opStart + openingMinutes, toMinutes(fr.end));
  const clEnd = toMinutes(lr.end);
  const clStart = Math.max(clEnd - closingMinutes, toMinutes(lr.start));

  const out: Omit<PlanSession, 'id'>[] = [
    { day: first.date, startTime: toHHMM(opStart), endTime: toHHMM(opEnd), kind: 'OPENING', unitId: null, note: null },
    { day: last.date, startTime: toHHMM(clStart), endTime: toHHMM(clEnd), kind: 'CLOSING', unitId: null, note: null },
  ];

  /* Khoảng trống để xếp đơn vị: mọi khoảng giờ của mọi ngày, trừ phần của hai cuộc họp. */
  const windows: Window[] = [];
  for (const d of days) {
    d.ranges.forEach((r, ri) => {
      let s = toMinutes(r.start);
      let e = toMinutes(r.end);
      if (d.date === first.date && ri === 0) s = Math.max(s, opEnd);
      if (d.date === last.date && ri === d.ranges.length - 1) e = Math.min(e, clStart);
      s = ceilStep(s);
      e = floorStep(e);
      if (e - s >= STEP) windows.push({ day: d.date, start: s, end: e });
    });
  }

  const unplacedUnitIds: string[] = [];
  if (windows.length === 0 || units.length === 0) {
    return { sessions: sortSessions(out), unplacedUnitIds: units.map((u) => u.id) };
  }

  const load = new Map<string, number>();
  for (const u of units) {
    for (const m of unitMembers.get(u.id) ?? []) load.set(m, (load.get(m) ?? 0) + 1);
  }

  if (load.size === 0) {
    /* --------- Cả đoàn đi cùng nhau: lấp kín từng khoảng theo thứ tự --------- */
    const counts = shareOut(units.length, windows.map((w) => w.end - w.start));
    let idx = 0;

    windows.forEach((w, wi) => {
      const n = counts[wi];
      if (n <= 0) return;
      const span = w.end - w.start;
      const base = floorStep(span / n);
      const extras = Math.floor((span - base * n) / STEP);

      let t = w.start;
      for (let k = 0; k < n && idx < units.length; k++, idx++) {
        const dur = base + (k < extras ? STEP : 0);
        if (dur <= 0) {
          unplacedUnitIds.push(units[idx].id);
          continue;
        }
        out.push({
          day: w.day, startTime: toHHMM(t), endTime: toHHMM(Math.min(t + dur, w.end)),
          kind: 'UNIT', unitId: units[idx].id, note: null,
        });
        t += dur;
      }
    });
    for (; idx < units.length; idx++) unplacedUnitIds.push(units[idx].id);
  } else {
    /* --------- Đã phân công: xếp song song, tránh trùng người --------- */
    const available = windows.reduce((n, w) => n + (w.end - w.start), 0);
    const longest = windows.reduce((mx, w) => Math.max(mx, w.end - w.start), 0);
    const busiest = Math.max(...load.values());
    // Chia theo số vòng của người bận nhất, không dài hơn khoảng trống dài nhất và nửa ngày.
    const per = Math.max(
      Math.min(MIN_SESSION, longest),
      Math.min(floorStep(available / busiest), longest, MAX_SESSION),
    );

    const placed: { day: string; start: number; end: number; members: string[] }[] = [];
    const free = (day: string, a: number, b: number, ms: string[]) =>
      !placed.some(
        (x) => x.day === day && a < x.end && x.start < b && x.members.some((y) => ms.includes(y)),
      );

    // Đơn vị nhiều người phụ trách xếp trước — càng dễ đụng lịch thì càng phải chọn chỗ sớm.
    const order = units
      .map((u, i) => ({ u, i }))
      .sort(
        (a, b) =>
          (unitMembers.get(b.u.id)?.length ?? 0) - (unitMembers.get(a.u.id)?.length ?? 0) || a.i - b.i,
      );

    for (const { u } of order) {
      // Đơn vị chưa ai phụ trách thì cả đoàn đi — không được chồng lên ai.
      const ms = unitMembers.get(u.id)?.length ? unitMembers.get(u.id)! : allMemberIds;

      let done = false;
      for (const w of windows) {
        const dur = Math.min(per, w.end - w.start);
        if (dur < Math.min(per, MIN_SESSION)) continue;

        for (let t = w.start; t + dur <= w.end; t += STEP) {
          if (!free(w.day, t, t + dur, ms)) continue;
          placed.push({ day: w.day, start: t, end: t + dur, members: ms });
          out.push({
            day: w.day, startTime: toHHMM(t), endTime: toHHMM(t + dur),
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

  return { sessions: sortSessions(out), unplacedUnitIds };
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
