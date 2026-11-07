import type { StandardCode } from './iso';

/**
 * Bộ câu hỏi thu thập thông tin đơn vị trước khi AI soạn checklist. Dùng chung
 * cho form (trình duyệt) và câu lệnh gửi AI (máy chủ) — sửa câu hỏi ở đây là
 * đổi cả hai nơi.
 *
 * `onlyIf`: câu hỏi chỉ hiện khi đợt có tiêu chuẩn đó.
 */
export const CHECKLIST_QUESTIONS = [
  {
    key: 'functions',
    label: 'Chức năng, nhiệm vụ chính của đơn vị là gì?',
    required: true,
  },
  {
    key: 'processes',
    label: 'Các quá trình / công việc chính đơn vị thực hiện hằng ngày?',
  },
  {
    key: 'personnel',
    label: 'Nhân sự: bao nhiêu người, những vị trí nào? Công việc nào cần chứng chỉ?',
  },
  {
    key: 'facilities',
    label:
      'Cơ sở vật chất, máy móc, thiết bị chính? Có thiết bị đo cần hiệu chuẩn, thiết bị nghiêm ngặt về an toàn không?',
  },
  {
    key: 'environment',
    label: 'Khía cạnh môi trường: chất thải, hoá chất, nước thải, khí thải, tiếng ồn?',
    onlyIf: 'ISO14001',
  },
  {
    key: 'safety',
    label: 'Mối nguy an toàn, công việc có rủi ro cao?',
    onlyIf: 'ISO45001',
  },
  {
    key: 'documents',
    label: 'Quy trình, hướng dẫn, biểu mẫu đơn vị đang áp dụng (nếu biết số hiệu)?',
  },
  {
    key: 'focus',
    label: 'Điểm cần lưu ý cho đợt này: sự không phù hợp kỳ trước, thay đổi gần đây, sự cố?',
  },
] as const satisfies readonly {
  key: string;
  label: string;
  required?: boolean;
  onlyIf?: StandardCode;
}[];

export type ChecklistQuestionKey = (typeof CHECKLIST_QUESTIONS)[number]['key'];
export type ChecklistAnswers = Partial<Record<ChecklistQuestionKey, string>>;

/** Số ký tự tối thiểu của câu bắt buộc — đủ để AI biết đơn vị làm gì. */
export const MIN_FUNCTIONS_LENGTH = 15;

/** Các câu hỏi áp dụng cho đợt có những tiêu chuẩn này. */
export function questionsFor(standards: readonly string[]) {
  return CHECKLIST_QUESTIONS.filter(
    (q) => !('onlyIf' in q) || standards.includes(q.onlyIf),
  );
}
