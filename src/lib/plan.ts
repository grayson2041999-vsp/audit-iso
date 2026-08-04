import { STANDARD_SHORT, type StandardCode } from './iso';

/**
 * Tiện ích cho chương trình đánh giá. File này KHÔNG nhập gì từ phía máy chủ
 * (không `auth`, không `db`) để component trình duyệt dùng chung được.
 */

export type Half = 'AM' | 'PM';
export type SessionKind = 'OPENING' | 'UNIT' | 'INTERNAL' | 'CLOSING';

export const HALF_LABELS: Record<Half, string> = { AM: 'Sáng', PM: 'Chiều' };

export const KIND_LABELS: Record<SessionKind, string> = {
  OPENING: 'Họp khai mạc',
  UNIT: 'Đánh giá đơn vị',
  INTERNAL: 'Họp đoàn đánh giá',
  CLOSING: 'Họp kết thúc',
};

export type PlanSession = {
  id: string;
  day: string;      // "YYYY-MM-DD"
  half: Half;
  kind: SessionKind;
  unitId: string | null;
  note: string | null;
};

/* ------------------------------------------------------------------ */
/* Ngày tháng                                                          */
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

/** Các ô buổi của cả đợt, theo thứ tự thời gian. */
export function listSlots(days: string[]): { day: string; half: Half }[] {
  return days.flatMap((day) => [
    { day, half: 'AM' as Half },
    { day, half: 'PM' as Half },
  ]);
}

/* ------------------------------------------------------------------ */
/* Xung đột                                                            */
/* ------------------------------------------------------------------ */

/**
 * Tìm các trường hợp một đánh giá viên bị xếp vào hai đơn vị trong cùng buổi.
 *
 * @param sessions   lịch hiện tại
 * @param unitMembers  đơn vị → danh sách id đánh giá viên phụ trách
 * @returns khoá "day|half|memberId" → danh sách unitId bị trùng
 */
export function findConflicts(
  sessions: PlanSession[],
  unitMembers: Map<string, string[]>,
): Map<string, string[]> {
  const busy = new Map<string, string[]>();

  for (const s of sessions) {
    if (s.kind !== 'UNIT' || !s.unitId) continue;
    for (const memberId of unitMembers.get(s.unitId) ?? []) {
      const key = `${s.day}|${s.half}|${memberId}`;
      busy.set(key, [...(busy.get(key) ?? []), s.unitId]);
    }
  }

  const conflicts = new Map<string, string[]>();
  for (const [key, units] of busy) if (units.length > 1) conflicts.set(key, units);
  return conflicts;
}

/* ------------------------------------------------------------------ */
/* Sinh lịch nháp                                                      */
/* ------------------------------------------------------------------ */

/**
 * Rải các đơn vị vào các buổi sao cho không đánh giá viên nào bị trùng giờ.
 *
 * Cách làm: xếp đơn vị "khó" trước — đơn vị có nhiều đánh giá viên thì càng dễ
 * đụng lịch người khác, nên phải chọn chỗ sớm khi còn nhiều ô trống. Với mỗi
 * đơn vị, tìm buổi sớm nhất mà mọi người phụ trách đều đang rảnh.
 *
 * Đây là bản NHÁP để trưởng đoàn sửa, không phải kết quả cuối.
 */
export function generateDraftPlan(input: {
  days: string[];
  units: { id: string }[];
  unitMembers: Map<string, string[]>;
}): Omit<PlanSession, 'id'>[] {
  const { days, units, unitMembers } = input;
  if (days.length === 0 || units.length === 0) return [];

  const slots = listSlots(days);
  const out: Omit<PlanSession, 'id'>[] = [];

  // Buổi sáng ngày đầu: họp khai mạc. Buổi chiều ngày cuối: họp kết thúc.
  out.push({ day: days[0], half: 'AM', kind: 'OPENING', unitId: null, note: null });
  out.push({
    day: days[days.length - 1], half: 'PM', kind: 'CLOSING', unitId: null, note: null,
  });

  /** "day|half|memberId" đã bận. */
  const busy = new Set<string>();

  const sorted = [...units].sort(
    (a, b) => (unitMembers.get(b.id)?.length ?? 0) - (unitMembers.get(a.id)?.length ?? 0),
  );

  const unplaced: string[] = [];

  for (const unit of sorted) {
    const members = unitMembers.get(unit.id) ?? [];

    // Đơn vị chưa có ai phụ trách thì không xếp — bước phân công chưa xong.
    if (members.length === 0) {
      unplaced.push(unit.id);
      continue;
    }

    const slot = slots.find((s) =>
      members.every((m) => !busy.has(`${s.day}|${s.half}|${m}`)),
    );

    if (!slot) {
      unplaced.push(unit.id);
      continue;
    }

    for (const m of members) busy.add(`${slot.day}|${slot.half}|${m}`);
    out.push({ day: slot.day, half: slot.half, kind: 'UNIT', unitId: unit.id, note: null });
  }

  // Đơn vị không xếp được vào đâu vẫn đưa vào buổi cuối để trưởng đoàn thấy và
  // tự sắp lại — giấu đi thì họ sẽ tưởng đã xếp đủ.
  const lastSlot = slots[slots.length - 1];
  for (const unitId of unplaced) {
    out.push({ day: lastSlot.day, half: lastSlot.half, kind: 'UNIT', unitId, note: null });
  }

  // Sắp theo thứ tự thời gian cho dễ đọc.
  const slotIndex = new Map(slots.map((s, i) => [`${s.day}|${s.half}`, i]));
  return out.sort(
    (a, b) =>
      (slotIndex.get(`${a.day}|${a.half}`) ?? 0) - (slotIndex.get(`${b.day}|${b.half}`) ?? 0),
  );
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
