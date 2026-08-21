import { clauseListByTier, STANDARD_SHORT, type StandardCode } from './iso';

/**
 * Bảy nhóm chủ đề, THEO ĐÚNG THỨ TỰ IN RA GIẤY.
 *
 * Không xếp theo số điều khoản (4 → 10) là có chủ đích: xếp kiểu đó thì buổi
 * phỏng vấn nhảy chủ đề liên tục — hỏi tài liệu ở 7.5, đi tiếp một đoạn rồi lại
 * quay về tài liệu ở 8.5.2. Xếp theo mạch công việc thì đánh giá viên đi một
 * mạch và đơn vị cũng dễ theo. Mã điều khoản vẫn còn, nhưng nằm trong ngoặc
 * cuối mỗi dòng chứ không quyết định thứ tự.
 *
 * `onlyIf` để nhóm tự biến mất khi đợt không đánh giá tiêu chuẩn tương ứng —
 * đợt chỉ có ISO 9001 mà vẫn in nhóm "Môi trường và chất thải" thì auditor mất
 * niềm tin vào cả tờ giấy.
 */
export const CHECKLIST_GROUPS: { name: string; onlyIf?: StandardCode }[] = [
  { name: 'Chức năng, nhiệm vụ và quá trình của đơn vị' },
  { name: 'Nhân sự, năng lực và nhận thức' },
  { name: 'Tài liệu, hồ sơ đang sử dụng' },
  { name: 'Quá trình chính của đơn vị' },
  { name: 'An toàn và sức khoẻ tại nơi làm việc', onlyIf: 'ISO45001' },
  { name: 'Môi trường và chất thải', onlyIf: 'ISO14001' },
  { name: 'Theo dõi, đo lường và khắc phục' },
];

export function groupsFor(standards: StandardCode[]) {
  return CHECKLIST_GROUPS.filter((g) => !g.onlyIf || standards.includes(g.onlyIf)).map((g) => g.name);
}

/**
 * Số dòng mong muốn, suy ra từ thời lượng phiên làm việc với đơn vị.
 *
 * Quy đổi khoảng BA PHÚT MỘT DÒNG. Không phải vì mỗi việc mất đúng ba phút —
 * xin một danh sách mất ba mươi giây, đối chiếu năm bộ hồ sơ mất mười lăm phút
 * — mà vì đây là con số duy nhất giữ được tờ giấy trong tầm một buổi. Checklist
 * dài hơn thời gian thực có thì auditor bỏ giữa chừng, và những dòng cuối cùng
 * (thường là phần khắc phục kỳ trước) là phần bị bỏ.
 *
 * Không có phiên nào trong lịch thì lấy 75 phút — độ dài quen thuộc của một
 * buổi làm việc với phòng ban.
 */
export function checklistSize(minutes: number | null) {
  const target = Math.min(40, Math.max(15, Math.round((minutes ?? 75) / 3)));
  return { lo: Math.max(12, target - 2), hi: Math.min(45, target + 2) };
}

export const CHECKLIST_SYSTEM_PROMPT = `Bạn là chuyên gia đánh giá nội bộ (Lead Auditor) được chứng nhận IRCA, có 15 năm kinh nghiệm đánh giá hệ thống quản lý tích hợp theo ISO 9001, ISO 14001 và ISO 45001. Nhiệm vụ của bạn là soạn DANH MỤC CÔNG VIỆC CẦN LÀM để một đánh giá viên mang theo khi vào làm việc với một đơn vị cụ thể.

## SẢN PHẨM NÀY LÀ GÌ

Một tờ giấy A4 đánh giá viên cầm vào phòng, liếc xuống là biết việc tiếp theo cần làm. KHÔNG phải bộ câu hỏi kiểm tra kiến thức của đơn vị, KHÔNG phải bản tóm tắt tiêu chuẩn, KHÔNG phải danh sách điều khoản có gắn thêm dấu hỏi.

Đánh giá viên KHÔNG bắt buộc làm hết. Họ chọn theo tình hình thực tế tại chỗ. Vì vậy mỗi dòng phải tự nó có giá trị, không phụ thuộc vào việc dòng trước đã làm hay chưa.

## NGUYÊN TẮC BẮT BUỘC

1. **Viết dạng HÀNH ĐỘNG, không viết dạng câu hỏi đóng.**
   Mỗi dòng trả lời được ba câu: LÀM GÌ — XEM HỒ SƠ NÀO — ĐỐI CHIẾU VỚI YÊU CẦU NÀO.

   ✗ "Đơn vị có kiểm soát hồ sơ đào tạo không?"
     → đơn vị đáp "Có" là hết chuyện, không kiểm chứng được gì.
   ✓ "Xin danh sách nhân sự và hồ sơ đào tạo năm nay; chọn 3 người đối chiếu với yêu cầu năng lực của vị trí họ đang giữ."
     → có việc để làm, có hồ sơ để xem, có cỡ mẫu, có cái để đối chiếu.

   Mở đầu bằng động từ: xin, yêu cầu xuất trình, chọn ngẫu nhiên, đối chiếu, quan sát tại chỗ, đi cùng tới…, hỏi người trực tiếp làm.
   TUYỆT ĐỐI KHÔNG mở đầu bằng "Đơn vị có…", "Kiểm tra xem có…", "Đánh giá việc…".

2. **Nêu cỡ mẫu ở những dòng có đối chiếu hồ sơ.** "chọn 3 hồ sơ gần nhất", "lấy 5 phiếu trong quý gần nhất". Con số cụ thể là thứ phân biệt một cuộc đánh giá có hệ thống với một cuộc trò chuyện.

3. **KHÔNG BỊA.** Tuyệt đối không tự tạo ra số hiệu tài liệu, tên biểu mẫu, mã quy trình, ngày tháng hay số liệu mà thông tin đầu vào không nêu. Nếu đầu vào có nêu (ví dụ đơn vị cho biết đang dùng "Quy trình QT-05") thì được dẫn đích danh; nếu không, viết chung: "quy trình nội bộ đang áp dụng cho công việc này", "biểu mẫu đơn vị đang dùng để ghi nhận".

4. **Bám vào ĐẶC THÙ của đơn vị này, không viết chung chung.** Thông tin đầu vào cho biết đơn vị làm gì thì công việc phải nói tới đúng thứ đó. Một dòng có thể bê nguyên sang bất kỳ đơn vị nào khác là một dòng vô dụng.

5. **GỘP ĐIỀU KHOẢN TRÙNG GIỮA BA TIÊU CHUẨN — điểm quan trọng nhất.**
   7.2 năng lực, 7.3 nhận thức, 7.4 trao đổi thông tin, 7.5 thông tin dạng văn bản, 10.2 khắc phục có nội dung gần trùng ở cả ISO 9001, ISO 14001 và ISO 45001. Đây là đánh giá hệ thống TÍCH HỢP: MỘT dòng công việc gắn NHIỀU mã điều khoản của nhiều tiêu chuẩn. Tuyệt đối không tạo ba dòng gần giống nhau cho ba tiêu chuẩn — đánh giá viên sẽ hỏi đơn vị ba lần cùng một câu.
   Chỉ tách riêng phần đặc thù thật sự: khía cạnh môi trường và nghĩa vụ tuân thủ của ISO 14001; nhận diện mối nguy, phân cấp kiểm soát, tham vấn người lao động của ISO 45001; kiểm soát đầu ra không phù hợp của ISO 9001.

6. **Ưu tiên điều khoản CẤP ĐƠN VỊ.** Danh mục bên dưới đã chia sẵn hai tầng. Chỉ lấy nhóm cấp hệ thống khi thông tin đầu vào cho thấy đơn vị này CHÍNH LÀ bộ phận giữ hệ thống quản lý (ban ISO, phòng quản lý chất lượng, thư ký hệ thống).

7. **Chỉ dùng mã điều khoản có trong danh mục được cung cấp.** Không tự chế mã. Mỗi dòng gắn từ 1 đến 4 viện dẫn; dòng mở đầu về chức năng nhiệm vụ có thể không gắn mã nào.

8. **Đúng số dòng yêu cầu, và phân bổ hợp lý.** Nhóm "Quá trình chính của đơn vị" nhận nhiều dòng nhất (khoảng một phần ba), vì đó là phần riêng có của đơn vị này. Nhóm mở đầu 2–3 dòng là đủ.

9. **Nhóm cuối luôn có một dòng về hiệu lực khắc phục kỳ trước**, viết chung vì bạn không biết kỳ trước đơn vị bị gì: "Hỏi các sự không phù hợp đơn vị nhận được ở kỳ đánh giá gần nhất; xin hồ sơ khắc phục và đối chiếu xem biện pháp đã thực hiện có còn được duy trì không."

10. **Ngôn ngữ: tiếng Việt.** Câu ngắn, đọc lướt được. Mỗi dòng tối đa khoảng 45 từ — dài hơn thì không lọt vào bề rộng cột trên giấy A4.

## ĐẦU RA

Trả kết quả bằng cách gọi công cụ \`soan_checklist\`. Không viết văn xuôi ngoài công cụ.`;

export function buildChecklistPrompt(input: {
  unitName: string;
  unitNote?: string | null;
  description: string;
  standards: StandardCode[];
  organization: string;
  objectives?: string | null;
  criteria?: string | null;
  sessionMinutes: number | null;
  auditorName?: string;
}) {
  const { lo, hi } = checklistSize(input.sessionMinutes);
  const groups = groupsFor(input.standards);

  const context = [
    `- Tổ chức được đánh giá: ${input.organization}`,
    `- Đơn vị được đánh giá: ${input.unitName}`,
    input.unitNote ? `- Ghi chú về đơn vị: ${input.unitNote}` : null,
    `- Tiêu chuẩn áp dụng trong đợt: ${input.standards.map((s) => STANDARD_SHORT[s]).join('; ')}`,
    input.objectives ? `- Mục tiêu đánh giá của đợt: ${input.objectives}` : null,
    input.criteria ? `- Chuẩn mực đánh giá của đợt: ${input.criteria}` : null,
    input.sessionMinutes
      ? `- Thời lượng phiên làm việc với đơn vị: ${input.sessionMinutes} phút`
      : '- Thời lượng phiên làm việc: chưa xếp lịch, ước khoảng 75 phút',
    input.auditorName ? `- Đánh giá viên: ${input.auditorName}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `## DANH MỤC ĐIỀU KHOẢN ĐƯỢC PHÉP VIỆN DẪN

${clauseListByTier(input.standards)}

## BỐI CẢNH ĐỢT ĐÁNH GIÁ

${context}

## CHỨC NĂNG, NHIỆM VỤ / QUY CHẾ HOẠT ĐỘNG CỦA ĐƠN VỊ

Do đánh giá viên thu thập được. Đây là nguồn duy nhất cho biết đơn vị này làm gì — mọi công việc bạn soạn phải bám vào nó.

"""
${input.description.trim()}
"""

## YÊU CẦU CHO LẦN NÀY

- Tổng số dòng trong cả checklist: **${lo}–${hi} dòng**. Đây là trần theo thời lượng phiên, không được vượt.
- Dùng đúng các nhóm sau, đúng thứ tự này, bỏ nhóm nào không có việc gì đáng làm:

${groups.map((g, i) => `  ${i + 1}. ${g}`).join('\n')}

Hãy soạn danh mục và gọi công cụ \`soan_checklist\` để trả kết quả.`;
}
