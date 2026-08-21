/**
 * Cơ sở tri thức điều khoản ISO dùng để AI viện dẫn chính xác.
 * Chỉ liệt kê tiêu đề điều khoản (không sao chép nội dung tiêu chuẩn có bản quyền).
 */

export type StandardCode = 'ISO9001' | 'ISO14001' | 'ISO45001';

export const STANDARD_LABELS: Record<StandardCode, string> = {
  ISO9001: 'ISO 9001:2015 — Hệ thống quản lý chất lượng',
  ISO14001: 'ISO 14001:2015 — Hệ thống quản lý môi trường',
  ISO45001: 'ISO 45001:2018 — Hệ thống quản lý an toàn & sức khoẻ nghề nghiệp',
};

export const STANDARD_SHORT: Record<StandardCode, string> = {
  ISO9001: 'ISO 9001:2015',
  ISO14001: 'ISO 14001:2015',
  ISO45001: 'ISO 45001:2018',
};

/** Màu riêng cho từng tiêu chuẩn — xanh lá cho môi trường, cam cho an toàn. */
export const STANDARD_STYLE: Record<StandardCode, string> = {
  ISO9001: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  ISO14001: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  ISO45001: 'bg-amber-50 text-amber-800 ring-amber-600/20',
};

/** Lĩnh vực của từng tiêu chuẩn, hiện kèm mã cho người chưa thuộc số hiệu. */
export const STANDARD_DOMAIN: Record<StandardCode, string> = {
  ISO9001: 'Chất lượng',
  ISO14001: 'Môi trường',
  ISO45001: 'An toàn & sức khoẻ',
};

const STANDARD_ORDER: StandardCode[] = ['ISO9001', 'ISO14001', 'ISO45001'];

/** Sắp theo thứ tự quen thuộc 9001 → 14001 → 45001, bỏ mã lạ. */
export function sortStandards(codes: string[]): StandardCode[] {
  return STANDARD_ORDER.filter((c) => codes.includes(c));
}

type Clause = [string, string];

export const ISO_CLAUSES: Record<StandardCode, Clause[]> = {
  ISO9001: [
    ['4.1', 'Hiểu tổ chức và bối cảnh của tổ chức'],
    ['4.2', 'Hiểu nhu cầu và mong đợi của các bên quan tâm'],
    ['4.3', 'Xác định phạm vi của hệ thống quản lý chất lượng'],
    ['4.4', 'Hệ thống quản lý chất lượng và các quá trình của hệ thống'],
    ['5.1.1', 'Sự lãnh đạo và cam kết — Khái quát'],
    ['5.1.2', 'Hướng vào khách hàng'],
    ['5.2', 'Chính sách chất lượng'],
    ['5.3', 'Vai trò, trách nhiệm và quyền hạn trong tổ chức'],
    ['6.1', 'Hành động giải quyết rủi ro và cơ hội'],
    ['6.2', 'Mục tiêu chất lượng và hoạch định để đạt được mục tiêu'],
    ['6.3', 'Hoạch định thay đổi'],
    ['7.1.1', 'Nguồn lực — Khái quát'],
    ['7.1.2', 'Nhân lực'],
    ['7.1.3', 'Cơ sở hạ tầng'],
    ['7.1.4', 'Môi trường cho việc thực hiện các quá trình'],
    ['7.1.5', 'Nguồn lực theo dõi và đo lường (bao gồm liên kết chuẩn đo lường)'],
    ['7.1.6', 'Tri thức của tổ chức'],
    ['7.2', 'Năng lực'],
    ['7.3', 'Nhận thức'],
    ['7.4', 'Trao đổi thông tin'],
    ['7.5.1', 'Thông tin dạng văn bản — Khái quát'],
    ['7.5.2', 'Tạo lập và cập nhật thông tin dạng văn bản'],
    ['7.5.3', 'Kiểm soát thông tin dạng văn bản'],
    ['8.1', 'Hoạch định và kiểm soát việc thực hiện'],
    ['8.2.1', 'Trao đổi thông tin với khách hàng'],
    ['8.2.2', 'Xác định các yêu cầu đối với sản phẩm và dịch vụ'],
    ['8.2.3', 'Xem xét các yêu cầu đối với sản phẩm và dịch vụ'],
    ['8.2.4', 'Thay đổi yêu cầu đối với sản phẩm và dịch vụ'],
    ['8.3', 'Thiết kế và phát triển sản phẩm, dịch vụ'],
    ['8.4.1', 'Kiểm soát quá trình, sản phẩm, dịch vụ do bên ngoài cung cấp — Khái quát'],
    ['8.4.2', 'Loại hình và mức độ kiểm soát nhà cung cấp'],
    ['8.4.3', 'Thông tin cho nhà cung cấp bên ngoài'],
    ['8.5.1', 'Kiểm soát sản xuất và cung cấp dịch vụ'],
    ['8.5.2', 'Nhận biết và truy xuất nguồn gốc'],
    ['8.5.3', 'Tài sản của khách hàng hoặc nhà cung cấp bên ngoài'],
    ['8.5.4', 'Bảo toàn'],
    ['8.5.5', 'Hoạt động sau giao hàng'],
    ['8.5.6', 'Kiểm soát thay đổi'],
    ['8.6', 'Thông qua sản phẩm và dịch vụ'],
    ['8.7', 'Kiểm soát đầu ra không phù hợp'],
    ['9.1.1', 'Theo dõi, đo lường, phân tích và đánh giá — Khái quát'],
    ['9.1.2', 'Sự thoả mãn của khách hàng'],
    ['9.1.3', 'Phân tích và đánh giá'],
    ['9.2', 'Đánh giá nội bộ'],
    ['9.3', 'Xem xét của lãnh đạo'],
    ['10.1', 'Cải tiến — Khái quát'],
    ['10.2', 'Sự không phù hợp và hành động khắc phục'],
    ['10.3', 'Cải tiến liên tục'],
  ],
  ISO14001: [
    ['4.1', 'Hiểu tổ chức và bối cảnh của tổ chức'],
    ['4.2', 'Hiểu nhu cầu và mong đợi của các bên quan tâm'],
    ['4.3', 'Xác định phạm vi của hệ thống quản lý môi trường'],
    ['4.4', 'Hệ thống quản lý môi trường'],
    ['5.1', 'Sự lãnh đạo và cam kết'],
    ['5.2', 'Chính sách môi trường'],
    ['5.3', 'Vai trò, trách nhiệm và quyền hạn trong tổ chức'],
    ['6.1.1', 'Hành động giải quyết rủi ro và cơ hội — Khái quát'],
    ['6.1.2', 'Khía cạnh môi trường'],
    ['6.1.3', 'Nghĩa vụ tuân thủ'],
    ['6.1.4', 'Hoạch định hành động'],
    ['6.2', 'Mục tiêu môi trường và hoạch định để đạt được mục tiêu'],
    ['7.1', 'Nguồn lực'],
    ['7.2', 'Năng lực'],
    ['7.3', 'Nhận thức'],
    ['7.4.1', 'Trao đổi thông tin — Khái quát'],
    ['7.4.2', 'Trao đổi thông tin nội bộ'],
    ['7.4.3', 'Trao đổi thông tin với bên ngoài'],
    ['7.5.1', 'Thông tin dạng văn bản — Khái quát'],
    ['7.5.2', 'Tạo lập và cập nhật'],
    ['7.5.3', 'Kiểm soát thông tin dạng văn bản'],
    ['8.1', 'Hoạch định và kiểm soát việc thực hiện'],
    ['8.2', 'Chuẩn bị sẵn sàng và ứng phó tình huống khẩn cấp'],
    ['9.1.1', 'Theo dõi, đo lường, phân tích và đánh giá — Khái quát'],
    ['9.1.2', 'Đánh giá sự tuân thủ'],
    ['9.2', 'Đánh giá nội bộ'],
    ['9.3', 'Xem xét của lãnh đạo'],
    ['10.1', 'Cải tiến — Khái quát'],
    ['10.2', 'Sự không phù hợp và hành động khắc phục'],
    ['10.3', 'Cải tiến liên tục'],
  ],
  ISO45001: [
    ['4.1', 'Hiểu tổ chức và bối cảnh của tổ chức'],
    ['4.2', 'Hiểu nhu cầu và mong đợi của người lao động và các bên quan tâm'],
    ['4.3', 'Xác định phạm vi của hệ thống quản lý ATSKNN'],
    ['4.4', 'Hệ thống quản lý ATSKNN'],
    ['5.1', 'Sự lãnh đạo và cam kết'],
    ['5.2', 'Chính sách ATSKNN'],
    ['5.3', 'Vai trò, trách nhiệm và quyền hạn trong tổ chức'],
    ['5.4', 'Tham vấn và tham gia của người lao động'],
    ['6.1.1', 'Hành động giải quyết rủi ro và cơ hội — Khái quát'],
    ['6.1.2.1', 'Nhận diện mối nguy'],
    ['6.1.2.2', 'Đánh giá rủi ro ATSKNN và các rủi ro khác'],
    ['6.1.2.3', 'Đánh giá cơ hội ATSKNN và các cơ hội khác'],
    ['6.1.3', 'Xác định yêu cầu pháp luật và yêu cầu khác'],
    ['6.1.4', 'Hoạch định hành động'],
    ['6.2', 'Mục tiêu ATSKNN và hoạch định để đạt được mục tiêu'],
    ['7.1', 'Nguồn lực'],
    ['7.2', 'Năng lực'],
    ['7.3', 'Nhận thức'],
    ['7.4', 'Trao đổi thông tin'],
    ['7.5', 'Thông tin dạng văn bản'],
    ['8.1.1', 'Hoạch định và kiểm soát việc thực hiện — Khái quát'],
    ['8.1.2', 'Loại bỏ mối nguy và giảm rủi ro ATSKNN (hệ thống phân cấp kiểm soát)'],
    ['8.1.3', 'Quản lý thay đổi'],
    ['8.1.4.1', 'Mua sắm — Khái quát'],
    ['8.1.4.2', 'Nhà thầu'],
    ['8.1.4.3', 'Thuê ngoài'],
    ['8.2', 'Chuẩn bị sẵn sàng và ứng phó tình huống khẩn cấp'],
    ['9.1.1', 'Theo dõi, đo lường, phân tích và đánh giá kết quả — Khái quát'],
    ['9.1.2', 'Đánh giá sự tuân thủ'],
    ['9.2', 'Đánh giá nội bộ'],
    ['9.3', 'Xem xét của lãnh đạo'],
    ['10.1', 'Cải tiến — Khái quát'],
    ['10.2', 'Sự cố, sự không phù hợp và hành động khắc phục'],
    ['10.3', 'Cải tiến liên tục'],
  ],
};

export function clauseListForPrompt(standards: StandardCode[]) {
  return standards
    .map((s) => {
      const rows = ISO_CLAUSES[s].map(([c, t]) => `  ${c} — ${t}`).join('\n');
      return `### ${STANDARD_SHORT[s]}\n${rows}`;
    })
    .join('\n\n');
}

export function isValidClause(standard: string, clause: string) {
  const code = (Object.keys(STANDARD_SHORT) as StandardCode[]).find(
    (k) => STANDARD_SHORT[k] === standard || k === standard,
  );
  if (!code) return false;
  return ISO_CLAUSES[code].some(([c]) => c === clause);
}

/**
 * Nhãn rút gọn — CHỈ dùng trong bảng tổng hợp, nơi cột đã có màu phân biệt nên
 * chữ chỉ đóng vai trò xác nhận. Mọi chỗ khác (ô chọn mức độ, dashboard, trang
 * chi tiết, file Excel) vẫn dùng nhãn đầy đủ để người đọc hiểu ngay nghĩa.
 */
export const SEVERITY_SHORT: Record<string, string> = {
  MAJOR: 'Major NC',
  MINOR: 'Minor NC',
  OBS: 'Obs',
  OFI: 'OFI',
  CONF: 'Phù hợp',
};

export const SEVERITY_LABELS: Record<string, string> = {
  MAJOR: 'Không phù hợp nặng (Major NC)',
  MINOR: 'Không phù hợp nhẹ (Minor NC)',
  OBS: 'Quan sát (Observation)',
  OFI: 'Cơ hội cải tiến (OFI)',
  CONF: 'Phù hợp (Conformity)',
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Bản nháp',
  AI_DRAFTED: 'AI đã chuẩn hoá',
  REVIEWED: 'Đã rà soát',
  ISSUED: 'Đã phát hành',
  CLOSED: 'Đã đóng',
};

/* ------------------------------------------------------------------ */
/* Phân tầng điều khoản — dùng khi sinh checklist đánh giá cho đơn vị   */
/* ------------------------------------------------------------------ */

/**
 * Những điều khoản mà MỘT PHÒNG/BAN/XƯỞNG trực tiếp chịu trách nhiệm thực hiện,
 * nên hỏi được ngay tại buổi làm việc với đơn vị.
 *
 * Phần còn lại của danh mục là điều khoản CẤP HỆ THỐNG — bối cảnh tổ chức, sự
 * lãnh đạo, chính sách, mục tiêu, xem xét của lãnh đạo. Hỏi trưởng một phân
 * xưởng về "bối cảnh của tổ chức" chỉ nhận được câu trả lời thuộc lòng, không
 * kiểm chứng được gì; những điều khoản đó thuộc buổi làm việc với lãnh đạo
 * hoặc với bộ phận giữ hệ thống.
 *
 * Đây là danh sách MỀM. Prompt vẫn cho model thấy trọn danh mục, chỉ đánh dấu
 * nhóm nào nên ưu tiên. Lọc cứng sẽ hỏng đúng vào lúc đơn vị được đánh giá
 * chính là ban ISO — khi đó điều khoản cấp hệ thống mới là phần chính.
 */
export const UNIT_LEVEL_CLAUSES: Record<StandardCode, string[]> = {
  ISO9001: [
    '7.1.3', '7.1.4', '7.1.5', '7.1.6', '7.2', '7.3', '7.4', '7.5.2', '7.5.3',
    '8.1', '8.2.1', '8.2.2', '8.2.3', '8.2.4', '8.3',
    '8.4.1', '8.4.2', '8.4.3',
    '8.5.1', '8.5.2', '8.5.3', '8.5.4', '8.5.5', '8.5.6',
    '8.6', '8.7', '9.1.1', '9.1.2', '9.1.3', '10.2',
  ],
  ISO14001: [
    '6.1.2', '6.1.3', '7.2', '7.3', '7.4.2', '7.4.3', '7.5.2', '7.5.3',
    '8.1', '8.2', '9.1.1', '9.1.2', '10.2',
  ],
  ISO45001: [
    '5.4', '6.1.2.1', '6.1.2.2', '6.1.3', '7.2', '7.3', '7.4', '7.5',
    '8.1.1', '8.1.2', '8.1.3', '8.1.4.1', '8.1.4.2', '8.1.4.3', '8.2',
    '9.1.1', '9.1.2', '10.2',
  ],
};

/**
 * Danh mục điều khoản chia hai tầng, dùng cho prompt sinh checklist.
 *
 * Khác `clauseListForPrompt` ở chỗ có gắn nhãn tầng — model cần biết nhóm nào
 * hỏi được ở đơn vị, nhóm nào để dành cho buổi làm việc với lãnh đạo.
 */
export function clauseListByTier(standards: StandardCode[]) {
  return standards
    .map((s) => {
      const unitLevel = UNIT_LEVEL_CLAUSES[s];
      const rows = (isUnitLevel: boolean) =>
        ISO_CLAUSES[s]
          .filter(([c]) => unitLevel.includes(c) === isUnitLevel)
          .map(([c, t]) => `  ${c} — ${t}`)
          .join('\n') || '  (không có)';

      return [
        `### ${STANDARD_SHORT[s]}`,
        '',
        'CẤP ĐƠN VỊ — ưu tiên lấy từ nhóm này:',
        rows(true),
        '',
        'CẤP HỆ THỐNG — chỉ dùng khi đơn vị được đánh giá chính là bộ phận giữ hệ thống:',
        rows(false),
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Nhãn ba chữ của từng tiêu chuẩn, chỉ dùng trong checklist in ra giấy.
 *
 * Trên tờ A4 mỗi dòng chỉ có 44% bề rộng cho phần chữ, nên viết đủ
 * "ISO 9001:2015 điều 7.2" ba lần là hết chỗ. QMS/EMS/OHS là ký hiệu quen
 * thuộc với người làm hệ thống quản lý và ngắn hơn bốn lần.
 */
export const STANDARD_TAG: Record<StandardCode, string> = {
  ISO9001: 'QMS',
  ISO14001: 'EMS',
  ISO45001: 'OHS',
};

function tagOf(standard: string): string {
  const code = (Object.keys(STANDARD_SHORT) as StandardCode[]).find(
    (k) => STANDARD_SHORT[k] === standard || k === standard,
  );
  return code ? STANDARD_TAG[code] : standard;
}

/**
 * Gom các viện dẫn của một dòng checklist thành một chuỗi ngắn:
 *
 *     [{9001, 7.2}, {14001, 7.2}, {45001, 7.2}]  →  "7.2 QMS/EMS/OHS"
 *     [{9001, 8.5.1}, {45001, 8.1.2}]            →  "8.5.1 QMS · 8.1.2 OHS"
 *
 * Gộp theo MÃ chứ không theo tiêu chuẩn, vì phần lớn điều khoản của mục 7 và
 * mục 10 trùng số hiệu ở cả ba tiêu chuẩn — đó chính là chỗ đánh giá tích hợp
 * tiết kiệm được công.
 */
export function formatClauseRefs(refs: { standard: string; clause: string }[]): string {
  const byClause = new Map<string, string[]>();
  for (const r of refs) {
    if (!r?.clause) continue;
    const tags = byClause.get(r.clause) ?? [];
    const tag = tagOf(r.standard ?? '');
    if (!tags.includes(tag)) tags.push(tag);
    byClause.set(r.clause, tags);
  }
  return [...byClause.entries()].map(([c, tags]) => `${c} ${tags.join('/')}`).join(' · ');
}
