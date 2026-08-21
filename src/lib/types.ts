import { z } from 'zod';

export const severitySchema = z.enum(['MAJOR', 'MINOR', 'OBS', 'OFI', 'CONF']);
export const standardCodeSchema = z.enum(['ISO9001', 'ISO14001', 'ISO45001']);

export const clauseRefSchema = z.object({
  standard: z.string(),
  clause: z.string(),
  clauseTitle: z.string(),
  reason: z.string().optional(),
});

/**
 * Kết quả AI trả về sau khi chuẩn hoá finding — "Gói B".
 *
 * Các trường đã chủ động lược bỏ và lý do:
 *  - process, area        : trùng với ô auditor tự nhập trong form, không được dùng ở đâu.
 *  - requirement,
 *    nonconformity        : nội dung đã nằm trong `statement`; yêu cầu R–N–E được siết
 *                           trực tiếp trong mô tả của `statement` để không giảm chất lượng.
 *  - riskAnalysis         : mức độ phân loại đã hàm ý mức nghiêm trọng.
 *  - suggestedAction      : auditor không đề xuất giải pháp cho vấn đề mình phát hiện
 *                           (nguyên tắc độc lập khi đánh giá lại hiệu lực khắc phục).
 *  - confidence           : điểm mô hình tự chấm hiệu chỉnh kém, tạo cảm giác chính xác giả.
 *                           `missingInfo` mới là cảnh báo có giá trị thực.
 *
 * Các cột tương ứng trong DB được giữ nguyên (để trống) để có thể khôi phục
 * mà không cần chạy lại migration.
 */
export const standardizedFindingSchema = z.object({
  title: z.string(),
  severity: severitySchema,
  severityRationale: z.string(),
  clauses: z.array(clauseRefSchema),
  evidence: z.array(z.string()),
  statement: z.string(),
  imageNotes: z.array(z.string()).optional().default([]),
  missingInfo: z.array(z.string()).optional().default([]),
});

export type StandardizedFinding = z.infer<typeof standardizedFindingSchema>;
export type ClauseRef = z.infer<typeof clauseRefSchema>;

export const standardizeRequestSchema = z.object({
  /**
   * BẮT BUỘC — dùng để XÁC THỰC người gọi, không phải để ghi dữ liệu.
   *
   * Cookie của đánh giá viên đặt riêng theo từng đợt (`am_<auditId>`), nên máy
   * chủ phải biết đợt nào mới tra được đúng cookie. Thiếu trường này thì route
   * không có cách nào biết người gọi là ai. Xem `lib/ai-quota.ts`.
   *
   * (`createFindingSchema` bên dưới ghi đè thành không bắt buộc, vì ở đó đợt
   * đã nằm trong đường dẫn `/api/dot/[id]/findings` rồi.)
   */
  auditId: z.string().uuid('Thiếu mã đợt đánh giá'),
  rawText: z.string().min(10, 'Nội dung ghi nhận cần tối thiểu 10 ký tự'),
  standards: z.array(standardCodeSchema).min(1, 'Chọn ít nhất một tiêu chuẩn'),
  area: z.string().optional(),
  auditorName: z.string().optional(),
  auditee: z.string().optional(),
  imageKeys: z.array(z.string()).optional().default([]),
});

export const createFindingSchema = standardizeRequestSchema.extend({
  auditId: z.string().uuid().optional().nullable(),
  code: z.string().optional(),
  observedAt: z.string().optional(),
  /** Thời hạn khắc phục, dạng "YYYY-MM-DD" từ ô chọn ngày. */
  dueDate: z.string().optional().nullable(),
  ai: standardizedFindingSchema.optional(),
  images: z
    .array(
      z.object({
        key: z.string(),
        fileName: z.string().optional(),
        contentType: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const updateFindingSchema = z.object({
  code: z.string().optional(),
  status: z.enum(['DRAFT', 'AI_DRAFTED', 'REVIEWED', 'ISSUED', 'CLOSED']).optional(),
  title: z.string().optional(),
  severity: severitySchema.optional(),
  evidence: z.array(z.string()).optional(),
  statement: z.string().optional(),
  clauses: z.array(clauseRefSchema).optional(),
  rawArea: z.string().optional(),
  auditee: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  editor: z.string().optional(),
  note: z.string().optional(),
});

/**
 * Số ngày khắc phục gợi ý theo mức độ. Sửa ở đây nếu đơn vị có quy định riêng.
 *
 * Chỉ MAJOR và MINOR bắt buộc phải khắc phục và bị theo dõi tới khi đóng.
 * OBS / OFI / CONF không bắt buộc nên để trống — đặt hạn cho chúng sẽ sinh ra
 * hàng loạt cảnh báo "quá hạn" cho việc không ai có nghĩa vụ làm.
 * Auditor vẫn tự điền ngày được nếu muốn.
 */
export const DUE_DAYS_BY_SEVERITY: Record<string, number | null> = {
  MAJOR: 30,
  MINOR: 60,
  OBS: null,
  OFI: null,
  CONF: null,
};

/** Trả về "YYYY-MM-DD" của hạn khắc phục gợi ý, hoặc chuỗi rỗng nếu không áp dụng. */
export function suggestDueDate(severity: string, from = new Date()): string {
  const days = DUE_DAYS_BY_SEVERITY[severity];
  if (days == null) return '';
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Checklist đánh giá — danh mục công việc AI soạn cho một đơn vị       */
/* ------------------------------------------------------------------ */

/**
 * Một dòng trên tờ giấy. `clauses` dùng lại `clauseRefSchema` để đi qua đúng
 * hàm hậu kiểm mã điều khoản đang dùng cho finding — không có danh mục viện
 * dẫn thứ hai trong app.
 */
export const checklistItemSchema = z.object({
  task: z.string().min(1),
  clauses: z.array(clauseRefSchema).optional().default([]),
});

export const checklistGroupSchema = z.object({
  name: z.string().min(1),
  items: z.array(checklistItemSchema),
});

export const checklistSchema = z.object({
  /**
   * Một hai câu model tóm tắt lại nó hiểu đơn vị này làm gì.
   *
   * Không in ra file Word. Tồn tại chỉ để đánh giá viên liếc qua là biết model
   * có hiểu đúng đầu vào không — hiểu sai thì sửa mô tả rồi sinh lại, rẻ hơn
   * nhiều so với phát hiện ra giữa buổi làm việc.
   */
  unitSummary: z.string(),
  groups: z.array(checklistGroupSchema),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistGroup = z.infer<typeof checklistGroupSchema>;
export type Checklist = z.infer<typeof checklistSchema>;

export const checklistRequestSchema = z.object({
  description: z
    .string()
    .min(30, 'Cần ít nhất 30 ký tự mô tả chức năng, nhiệm vụ của đơn vị'),
});

/**
 * Thân request khi tải file Word.
 *
 * Client gửi lên các dòng ĐÃ SỬA chứ không phải bản model trả về, vì đánh giá
 * viên được phép sửa chữ, xoá dòng và thêm dòng tự viết ở màn hình xem trước.
 * Máy chủ không giữ bản nào để đối chiếu — checklist không lưu vào cơ sở dữ
 * liệu, xem `docs/concept-checklist.md` mục 8.
 */
export const checklistExportSchema = z.object({
  groups: z.array(checklistGroupSchema).min(1, 'Checklist rỗng'),
});
