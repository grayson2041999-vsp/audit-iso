import {
  AlignmentType, BorderStyle, Document, HeightRule, Paragraph, Table, TableCell,
  TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { STANDARD_SHORT, formatClauseRefs, sortStandards, type StandardCode } from '@/lib/iso';
import type { ChecklistGroup } from '@/lib/types';

/**
 * Dựng file Word cho checklist đánh giá — TOÀN BỘ phần bố cục nằm ở đây.
 *
 * Tách khỏi route vì hai lý do. Một, dựng được tài liệu mà không cần cơ sở dữ
 * liệu hay phiên đăng nhập, nên soi lại bố cục cột và chiều cao dòng chỉ mất
 * một lệnh chạy thử. Hai, route giờ chỉ còn làm đúng việc của nó: kiểm quyền,
 * đọc dữ liệu, đóng gói phản hồi.
 */

export type ChecklistDocInput = {
  organization: string;
  auditTitle: string;
  unitName: string;
  /** Mã tiêu chuẩn của đợt, chưa sắp thứ tự. */
  standards: string[];
  auditorName: string;
  groups: ChecklistGroup[];
};

const FONT = 'Times New Roman';

/**
 * BỀ RỘNG CỘT TÍNH BẰNG TWIP, KHÔNG TÍNH BẰNG PHẦN TRĂM — và đi kèm
 * `layout: FIXED`. Đây là chỗ đã làm sai một lần nên ghi lại cho rõ.
 *
 * Đặt bề rộng theo phần trăm thì Word vẫn tự co giãn cột theo nội dung: cột
 * STT chỉ chứa một hai chữ số mà phình ra bằng một phần tư trang, còn cột
 * "Công việc cần làm" — cột duy nhất có chữ thật — bị bóp lại còn hơn hai mươi
 * phần trăm, chữ rơi xuống bảy tám dòng và tờ giấy dài gấp rưỡi cần thiết.
 *
 * A4 rộng 11906 twip, trừ lề trái 1000 và lề phải 800 còn 10106 twip cho bảng.
 * Bốn số dưới đây cộng lại đúng bằng 10106; sửa số nào thì phải sửa số khác
 * cho tổng không đổi.
 */
const COL = {
  stt: 720,     //  7%  — hẹp hơn thì chính chữ "STT" ở dòng tiêu đề bị xuống dòng
  task: 4450,   // 44%  — cột duy nhất chứa câu chữ thật
  tick: 1010,   // 10%  — vừa một ô vuông
  note: 3926,   // 39%  — chỗ viết tay tại chỗ
};
const COL_WIDTHS = [COL.stt, COL.task, COL.tick, COL.note];
const GRAY = 'DDDDDD';
const HEAD_SHADE = 'F1F5F9';
const GROUP_SHADE = 'E8EDF3';

/** Chiều cao tối thiểu một dòng, đơn vị twip. 700 ≈ 1,23 cm — đủ viết tay hai dòng chữ. */
const ROW_HEIGHT = 700;

function p(
  text: string,
  opts: {
    bold?: boolean;
    italics?: boolean;
    size?: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    after?: number;
  } = {},
) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.after ?? 100 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: opts.size ?? 24,
        font: FONT,
      }),
    ],
  });
}

function cell(
  children: Paragraph[],
  opts: { width?: number; shade?: string; span?: number } = {},
) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shade ? { fill: opts.shade } : undefined,
    columnSpan: opts.span,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children,
  });
}

function textCell(
  text: string,
  opts: {
    bold?: boolean;
    width?: number;
    shade?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    span?: number;
  } = {},
) {
  return cell(
    [
      new Paragraph({
        alignment: opts.align,
        spacing: { after: 0 },
        children: [new TextRun({ text, bold: opts.bold, size: 22, font: FONT })],
      }),
    ],
    opts,
  );
}

/**
 * Ô "Công việc cần làm": câu việc, rồi mã điều khoản nối ngay sau trong ngoặc,
 * chữ nhỏ và nghiêng.
 *
 * Cố tình KHÔNG tách mã điều khoản thành cột thứ năm. Bốn cột đã ăn hết bề
 * rộng A4 dọc; thêm cột nữa thì cột Ghi chú hẹp lại và không còn viết tay được
 * — mà ghi chú mới là thứ đánh giá viên dùng nhiều nhất trong buổi làm việc.
 */
function taskCell(task: string, clauseText: string) {
  const runs = [new TextRun({ text: task, size: 22, font: FONT })];
  if (clauseText) {
    runs.push(new TextRun({ text: `  (${clauseText})`, size: 18, italics: true, font: FONT, color: '555555' }));
  }
  return cell([new Paragraph({ spacing: { after: 0 }, children: runs })], { width: COL.task });
}

export function buildChecklistDoc(input: ChecklistDocInput): Document {
  const standards = sortStandards(input.standards)
    .map((s: StandardCode) => STANDARD_SHORT[s])
    .join(' · ');

  const body: (Paragraph | Table)[] = [];

  /* ---------------- Đầu trang ---------------- */

  body.push(
    p(input.organization.toLocaleUpperCase('vi'), {
      bold: true, align: AlignmentType.CENTER, after: 60,
    }),
    p('DANH MỤC CÔNG VIỆC ĐÁNH GIÁ', {
      bold: true, size: 32, align: AlignmentType.CENTER, after: 240,
    }),
  );

  const info: [string, string][] = [
    ['Đợt đánh giá', input.auditTitle],
    ['Đơn vị được đánh giá', input.unitName],
    ['Tiêu chuẩn áp dụng', standards || '—'],
    ['Đánh giá viên', input.auditorName],
    ['Ngày đánh giá', '……… / ……… / 20………'],
  ];

  body.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [2650, 7456],
      layout: TableLayoutType.FIXED,
      borders: noBorders(),
      rows: info.map(
        ([k, v]) =>
          new TableRow({
            children: [
              textCell(`${k}:`, { bold: true, width: 2650 }),
              textCell(v, { width: 7456 }),
            ],
          }),
      ),
    }),
    p('', { after: 120 }),
  );

  /**
   * Câu này không phải thủ tục thừa.
   *
   * Checklist do AI soạn rất dễ tạo cảm giác an toàn giả — bám cứng vào tờ giấy
   * thì bỏ lỡ dấu hiệu ngay trước mắt. Câu ghi chú đứng ngay đầu bảng để đánh
   * giá viên đọc nó trước khi đọc dòng đầu tiên, và để người sau này cầm tờ
   * giấy lên không hiểu nhầm các dòng bỏ trống là công việc bị bỏ sót.
   */
  body.push(
    p(
      'Danh mục này do hệ thống gợi ý để đánh giá viên tham khảo. Không bắt buộc thực hiện hết ' +
        'các mục, và không giới hạn phạm vi đánh giá — mọi phát hiện ngoài danh mục vẫn được ' +
        'ghi nhận bình thường.',
      { italics: true, size: 20, after: 160 },
    ),
  );

  /* ---------------- Bảng chính ---------------- */

  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        textCell('STT', { bold: true, width: COL.stt, shade: HEAD_SHADE, align: AlignmentType.CENTER }),
        textCell('Công việc cần làm', { bold: true, width: COL.task, shade: HEAD_SHADE }),
        textCell('Đánh tích', { bold: true, width: COL.tick, shade: HEAD_SHADE, align: AlignmentType.CENTER }),
        textCell('Ghi chú', { bold: true, width: COL.note, shade: HEAD_SHADE }),
      ],
    }),
  ];

  /**
   * STT chạy liên tục qua các nhóm, không đánh lại từ 1 ở mỗi nhóm.
   *
   * Đánh giá viên gọi nhau "mục 14" giữa buổi, và cuối buổi đối chiếu lại với
   * ghi nhận của mình. Số trùng nhau giữa các nhóm sẽ hỏng cả hai việc đó.
   */
  let stt = 0;

  for (const group of input.groups) {
    if (group.items.length === 0) continue;

    rows.push(
      new TableRow({
        children: [
          textCell(group.name.toLocaleUpperCase('vi'), { bold: true, shade: GROUP_SHADE, span: 4 }),
        ],
      }),
    );

    for (const item of group.items) {
      stt++;
      rows.push(
        new TableRow({
          height: { value: ROW_HEIGHT, rule: HeightRule.ATLEAST },
          cantSplit: true,
          children: [
            textCell(String(stt), { width: COL.stt, align: AlignmentType.CENTER }),
            taskCell(item.task, formatClauseRefs(item.clauses ?? [])),
            textCell('☐', { width: COL.tick, align: AlignmentType.CENTER }),
            textCell('', { width: COL.note }),
          ],
        }),
      );
    }
  }

  /**
   * Ba dòng trắng đánh số tiếp.
   *
   * Chỗ để đánh giá viên viết việc phát sinh tại chỗ — thứ hay có giá trị nhất
   * trong cả buổi, vì nó đến từ quan sát chứ không từ danh mục soạn sẵn.
   */
  rows.push(
    new TableRow({
      children: [
        textCell('PHÁT HIỆN NGOÀI DANH MỤC', { bold: true, shade: GROUP_SHADE, span: 4 }),
      ],
    }),
  );
  for (let i = 0; i < 3; i++) {
    stt++;
    rows.push(
      new TableRow({
        height: { value: ROW_HEIGHT, rule: HeightRule.ATLEAST },
        cantSplit: true,
        children: [
          textCell(String(stt), { width: COL.stt, align: AlignmentType.CENTER }),
          textCell('', { width: COL.task }),
          textCell('☐', { width: COL.tick, align: AlignmentType.CENTER }),
          textCell('', { width: COL.note }),
        ],
      }),
    );
  }

  body.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: COL_WIDTHS,
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
        left: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
        right: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
      },
      rows,
    }),
  );

  /* ---------------- Đóng gói ---------------- */

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 276 } } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 800 } } },
        children: body,
      },
    ],
  });


  return doc;
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}

export function checklistFileName(unitName: string) {
  const slug = unitName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'don-vi'}_checklist-danh-gia.docx`;
}
