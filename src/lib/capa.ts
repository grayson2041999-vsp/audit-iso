import type { CorrectiveItem } from './schema';

/**
 * Quy tắc của luồng khắc phục. File này KHÔNG chạm database và KHÔNG dùng
 * `next/headers`, nên gọi được từ cả máy chủ lẫn trình duyệt.
 */

/* ------------------------------------------------------------------ */
/* Finding nào phải khắc phục                                          */
/* ------------------------------------------------------------------ */

/**
 * Chỉ sự không phù hợp mới bắt buộc có hành động khắc phục.
 *
 * OBS / OFI / CONF không nằm trong danh sách này — khớp với
 * `DUE_DAYS_BY_SEVERITY` bên `types.ts`, nơi ba mức đó cố tình để trống hạn.
 * Bắt đơn vị lập hồ sơ CAPA cho một cơ hội cải tiến là cách nhanh nhất khiến
 * họ ghét cả công cụ lẫn việc đánh giá — và về nguyên tắc cũng sai, vì OFI
 * không phải vi phạm yêu cầu nào.
 */
export const NEEDS_CAPA = ['MAJOR', 'MINOR'] as const;

export function needsCapa(severity?: string | null) {
  return severity != null && (NEEDS_CAPA as readonly string[]).includes(severity);
}

/* ------------------------------------------------------------------ */
/* Trạng thái                                                          */
/* ------------------------------------------------------------------ */

export type CapaStatus =
  | 'PLAN_DRAFT'
  | 'PLAN_SUBMITTED'
  | 'PLAN_REJECTED'
  | 'PLAN_APPROVED'
  | 'EVIDENCE_SUBMITTED'
  | 'EVIDENCE_REJECTED'
  | 'CLOSED';

/** Nhãn nhìn từ phía ĐƠN VỊ — nói cho họ biết đang phải làm gì. */
export const CAPA_LABEL_UNIT: Record<CapaStatus, string> = {
  PLAN_DRAFT: 'Chưa trình kế hoạch',
  PLAN_SUBMITTED: 'Đã trình kế hoạch, chờ duyệt',
  PLAN_REJECTED: 'Kế hoạch bị trả lại — cần sửa',
  PLAN_APPROVED: 'Kế hoạch đã duyệt — đang thực hiện',
  EVIDENCE_SUBMITTED: 'Đã nộp bằng chứng, chờ xác nhận',
  EVIDENCE_REJECTED: 'Bằng chứng chưa đạt — cần bổ sung',
  CLOSED: 'Đã đóng',
};

/** Nhãn nhìn từ phía TRƯỞNG ĐOÀN — nói cho họ biết có phải xử lý gì không. */
export const CAPA_LABEL_LEADER: Record<CapaStatus, string> = {
  PLAN_DRAFT: 'Chưa nộp',
  PLAN_SUBMITTED: 'Chờ duyệt kế hoạch',
  PLAN_REJECTED: 'Đã trả lại kế hoạch',
  PLAN_APPROVED: 'Đang thực hiện',
  EVIDENCE_SUBMITTED: 'Chờ xác nhận hiệu lực',
  EVIDENCE_REJECTED: 'Đã trả lại bằng chứng',
  CLOSED: 'Đã đóng',
};

export const CAPA_STYLE: Record<CapaStatus, string> = {
  PLAN_DRAFT: 'bg-slate-100 text-slate-600 ring-slate-300',
  PLAN_SUBMITTED: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  PLAN_REJECTED: 'bg-red-50 text-red-700 ring-red-600/20',
  PLAN_APPROVED: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  EVIDENCE_SUBMITTED: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  EVIDENCE_REJECTED: 'bg-red-50 text-red-700 ring-red-600/20',
  CLOSED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};

/** Trưởng đoàn phải làm gì đó — dùng để đếm việc tồn trên màn hình danh sách. */
export function waitingOnLeader(status: CapaStatus) {
  return status === 'PLAN_SUBMITTED' || status === 'EVIDENCE_SUBMITTED';
}

/** Đơn vị phải làm gì đó. */
export function waitingOnUnit(status: CapaStatus) {
  return (
    status === 'PLAN_DRAFT' ||
    status === 'PLAN_REJECTED' ||
    status === 'PLAN_APPROVED' ||
    status === 'EVIDENCE_REJECTED'
  );
}

/**
 * Đơn vị đang ở mốc nào: nhập kế hoạch hay nộp bằng chứng.
 *
 * Quyết định giao diện nào hiện ra cho đơn vị, và lời gọi nộp thuộc pha nào.
 */
export function currentPhase(status: CapaStatus): 'plan' | 'evidence' | 'done' {
  if (status === 'CLOSED') return 'done';
  if (status === 'PLAN_APPROVED' || status === 'EVIDENCE_SUBMITTED' || status === 'EVIDENCE_REJECTED') {
    return 'evidence';
  }
  return 'plan';
}

/** Đơn vị còn sửa và nộp được không. */
export function unitCanEdit(status: CapaStatus) {
  return waitingOnUnit(status);
}

/* ------------------------------------------------------------------ */
/* Điều kiện nộp                                                       */
/* ------------------------------------------------------------------ */

/**
 * Kiểm tra gói đã đủ để nộp chưa. Trả về danh sách chỗ còn thiếu, rỗng là đủ.
 *
 * Cùng một hàm chạy ở CẢ HAI phía: trình duyệt gọi để bật/tắt nút Nộp, máy chủ
 * gọi lại để chặn thật. Trình duyệt chỉ là gợi ý, không phải hàng rào.
 *
 * Ba trường bắt buộc ở mốc kế hoạch bám theo ISO 9001 §10.2.1:
 *   b1) xử lý hậu quả              → immediateAction
 *   b2) phân tích nguyên nhân      → rootCause
 *   c)  thực hiện hành động cần    → actionPlan + targetDate
 */
export function missingForSubmit(
  phase: 'plan' | 'evidence',
  items: Pick<
    CorrectiveItem,
    'immediateAction' | 'rootCause' | 'actionPlan' | 'targetDate' | 'completionNote' | 'attachments'
  >[],
  responsible?: { name?: string | null; title?: string | null },
): string[] {
  const missing: string[] = [];

  if (phase === 'plan') {
    if (!responsible?.name?.trim()) missing.push('Họ tên lãnh đạo đơn vị chịu trách nhiệm');
    if (!responsible?.title?.trim()) missing.push('Chức danh người chịu trách nhiệm');
  }

  items.forEach((it, i) => {
    const stt = `Mục ${i + 1}`;
    if (phase === 'plan') {
      if (!it.immediateAction?.trim()) missing.push(`${stt}: chưa nêu biện pháp xử lý ngay`);
      if (!it.rootCause?.trim()) missing.push(`${stt}: chưa phân tích nguyên nhân gốc`);
      if (!it.actionPlan?.trim()) missing.push(`${stt}: chưa nêu hành động khắc phục`);
      if (!it.targetDate) missing.push(`${stt}: chưa đặt thời hạn hoàn thành`);
    } else {
      if (!it.completionNote?.trim()) missing.push(`${stt}: chưa mô tả kết quả đã thực hiện`);
    }
  });

  return missing;
}

/* ------------------------------------------------------------------ */
/* Mã 8 số của đơn vị                                                  */
/* ------------------------------------------------------------------ */

/**
 * Sinh mã 8 số, tránh trùng trong cùng một đợt.
 *
 * KHÔNG có khoá thử sai — quyết định đã chốt: phạm vi nội bộ, không yêu cầu
 * bảo mật cao. Ghi lại ở đây để sau này ai đọc code không tưởng là sơ suất.
 * Nếu đưa vào dùng với dữ liệu nhạy cảm thì đây là chỗ sửa đầu tiên.
 */
export function generateUnitCode(taken: Set<string>): string {
  for (let i = 0; i < 500; i++) {
    const code = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  throw new Error('Không sinh được mã mới, vui lòng thử lại.');
}
