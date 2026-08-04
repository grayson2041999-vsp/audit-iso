import { sameUnitName } from './utils';

/**
 * Tự phân công đánh giá viên cho các đơn vị.
 *
 * Đây là GỢI Ý, không phải quyết định: kết quả đổ thẳng vào ma trận ở bước
 * Chuẩn bị để trưởng đoàn xem, sửa tay rồi mới bấm Lưu. Không ghi thẳng vào
 * database — người chịu trách nhiệm về tính độc lập của đoàn là trưởng đoàn,
 * không phải thuật toán.
 *
 * Ba tiêu chí, xét theo đúng thứ tự này:
 *
 *  1. ĐỘC LẬP — không xếp ai vào đúng đơn vị họ đang công tác. Đây là yêu cầu
 *     của ISO 19011 về tính khách quan, nên nó đứng trước mọi tiêu chí khác.
 *     Chỉ phá lệ khi không còn ai khác, và khi đó phải báo rõ ra ngoài.
 *
 *  2. CÂN BẰNG TẢI — luôn chọn người đang giữ ít đơn vị nhất. Cách tham lam này
 *     cho chênh lệch tối đa 1 đơn vị giữa người nhiều nhất và người ít nhất,
 *     tức là bằng mức tối ưu. Cân bằng tải không chỉ để công bằng: người bận
 *     nhất chính là đường găng quyết định độ dài cả đợt (xem plan.ts).
 *
 *  3. XOAY CẶP — khi mỗi đơn vị cần từ 2 người trở lên, ưu tiên người ít đi
 *     cùng với những người đã chọn cho đơn vị này nhất. Tránh việc hai người
 *     đi cặp với nhau suốt cả đợt, vốn làm cách nhìn của đoàn bị đồng nhất.
 */

export type AssignMember = {
  id: string;
  fullName: string;
  homeUnit?: string | null;
};

export type AssignInput = {
  units: { id: string; name: string }[];
  members: AssignMember[];
  /** Số đánh giá viên cùng vào một đơn vị. */
  auditorsPerUnit: number;
};

export type AssignResult = {
  /** Cặp "memberId:unitId", đúng định dạng ma trận đang dùng. */
  pairs: string[];
  /** Số đơn vị của người ít nhất và người nhiều nhất. */
  minLoad: number;
  maxLoad: number;
  /** Đơn vị buộc phải xếp người của chính đơn vị đó. */
  selfAudited: string[];
};

const EMPTY: AssignResult = { pairs: [], minLoad: 0, maxLoad: 0, selfAudited: [] };

export function autoAssign({ units, members, auditorsPerUnit }: AssignInput): AssignResult {
  if (units.length === 0 || members.length === 0) return EMPTY;

  // Không thể xếp nhiều người hơn số người đang có trong đoàn.
  const k = Math.max(1, Math.min(Math.round(auditorsPerUnit), members.length));

  const order = new Map(members.map((m, i) => [m.id, i]));
  const load = new Map(members.map((m) => [m.id, 0]));
  /** Số lần hai người đã được xếp đi cùng nhau. Khoá là cặp id đã sắp xếp. */
  const together = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const pairs: string[] = [];
  const selfAudited: string[] = [];

  for (const unit of units) {
    const chosen: string[] = [];

    for (let slot = 0; slot < k; slot++) {
      const rest = members.filter((m) => !chosen.includes(m.id));
      if (rest.length === 0) break;

      // Ưu tiên tuyệt đối cho người không thuộc đơn vị này.
      const independent = rest.filter((m) => !sameUnitName(m.homeUnit, unit.name));
      const pool = independent.length > 0 ? independent : rest;
      if (independent.length === 0 && !selfAudited.includes(unit.name)) {
        selfAudited.push(unit.name);
      }

      /** Người này đã đi cùng những người đã chọn cho đơn vị này bao nhiêu lần. */
      const cost = (m: AssignMember) =>
        chosen.reduce((sum, c) => sum + (together.get(pairKey(m.id, c)) ?? 0), 0);

      // Ba tiêu chí xét lần lượt: tải nhẹ nhất → ít đi cặp nhất → thứ tự khai báo.
      const rank = (m: AssignMember) => [load.get(m.id)!, cost(m), order.get(m.id)!];
      const pick = pool.reduce((best, m) => {
        const [a, b] = [rank(m), rank(best)];
        for (let x = 0; x < a.length; x++) {
          if (a[x] !== b[x]) return a[x] < b[x] ? m : best;
        }
        return best;
      });

      for (const c of chosen) {
        const key = pairKey(pick.id, c);
        together.set(key, (together.get(key) ?? 0) + 1);
      }
      chosen.push(pick.id);
      load.set(pick.id, load.get(pick.id)! + 1);
      pairs.push(`${pick.id}:${unit.id}`);
    }
  }

  const values = [...load.values()];
  return {
    pairs,
    minLoad: Math.min(...values),
    maxLoad: Math.max(...values),
    selfAudited,
  };
}
