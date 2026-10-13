import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { SEVERITY_LABELS } from './iso';

/**
 * Dựng file Excel "Tổng hợp finding".
 *
 * Tách khỏi route `/api/audits/[id]/xuat-excel` để route chỉ lo việc kiểm
 * quyền và lấy dữ liệu, còn file này chỉ lo trình bày — nhờ vậy dựng được
 * file mẫu mà không cần database hay R2.
 */

export type XlsxFinding = {
  id: string;
  code: string | null;
  severity: string | null;
  auditee: string | null;
  rawArea: string | null;
  clauses: { standard: string; clause: string }[];
  statement: string | null;
  rawText: string;
  evidence: string[];
  dueDate: Date | null;
  auditorName: string | null;
  status: string;
  unitId: string | null;
  memberId: string | null;
};

export type XlsxInput = {
  audit: {
    title: string;
    organization: string;
    startDate: Date | null;
    endDate: Date | null;
    leadAuditor: string | null;
  };
  rows: XlsxFinding[];
  units: { id: string; name: string }[];
  members: { id: string; fullName: string }[];
  /**
   * Ảnh gốc của từng finding, theo đúng thứ tự hiển thị. Khoá là `finding.id`.
   * Chỉ cần đưa tối đa `MAX_PHOTOS` ảnh mỗi finding — số ảnh thật (để ghi
   * "+N ảnh") lấy từ `photoCounts`.
   */
  photos?: Map<string, Buffer[]>;
  photoCounts?: Map<string, number>;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Bản nháp (chưa nộp)',
  AI_DRAFTED: 'Bản nháp (chưa nộp)',
  SUBMITTED: 'Đã nộp',
  REVIEWED: 'Đã rà soát',
  ISSUED: 'Đã phát hành',
  CLOSED: 'Đã đóng',
};

const d = (x: Date | null) =>
  x ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(x) : '';

/* ------------------------------------------------------------------ */
/* Ảnh thu nhỏ                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ảnh thu nhỏ CHÈN THẲNG vào file, không dùng đường link.
 *
 * Link xem ảnh của app là link presigned, hết hạn sau một giờ — dán vào Excel
 * thì gửi file đi hôm sau là link chết. Chèn ảnh vào file thì file tự đứng
 * được: gửi qua email, in ra, mở lại sau một năm vẫn thấy.
 */
/** Số ảnh tối đa mỗi finding: lưới 2 × 2. Nhiều hơn thì ghi "+N ảnh". */
export const MAX_PHOTOS = 4;
/** Khung hiển thị của một ảnh trên trang tính, tính bằng pixel. */
const THUMB_W = 120;
const THUMB_H = 90;
const GAP = 6;
/**
 * Ảnh lưu trong file to gấp 2,5 lần khung hiển thị, để phóng to trên màn
 * hình hoặc in ra vẫn đọc được chữ trên tem, nhãn. Vẫn chỉ ~20–40 KB một ảnh.
 */
const THUMB_SCALE = 2.5;
const THUMB_QUALITY = 72;
/** Đơn vị đo nội bộ của Excel: 9 525 EMU = 1 pixel. */
const EMU_PER_PX = 9525;

/** Cột ảnh: đủ rộng cho hai ảnh đặt cạnh nhau. */
const PHOTO_COL_PX = THUMB_W * 2 + GAP * 3;

async function makeThumb(bytes: Buffer) {
  const { data, info } = await sharp(bytes)
    .rotate() // xoay theo EXIF — thiếu là ảnh điện thoại nằm nghiêng
    .resize({
      width: Math.round(THUMB_W * THUMB_SCALE),
      height: Math.round(THUMB_H * THUMB_SCALE),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer({ resolveWithObject: true });

  // Co về khung hiển thị, giữ nguyên tỉ lệ ảnh.
  const scale = Math.min(THUMB_W / info.width, THUMB_H / info.height);
  return {
    data,
    width: Math.round(info.width * scale),
    height: Math.round(info.height * scale),
  };
}

/* ------------------------------------------------------------------ */
/* Ước lượng chiều cao dòng                                            */
/* ------------------------------------------------------------------ */

/**
 * Excel không tự giãn dòng cho vừa ảnh — ảnh chỉ "nổi" trên ô. Dòng có ảnh
 * phải được đặt chiều cao bằng tay, mà đặt tay thì Excel cũng thôi tự giãn
 * theo chữ. Nên phải tự ước lượng: lấy cái cao hơn giữa phần ảnh và phần chữ.
 *
 * Ước lượng thô (≈ 1 ký tự / đơn vị độ rộng cột, 15pt / dòng) và cố ý dư một
 * chút — thừa một khoảng trắng còn hơn chữ bị che mất.
 */
function textHeightPt(text: string, colWidth: number) {
  const perLine = Math.max(8, Math.floor(colWidth * 1.05));
  const lines = text
    .split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return lines * 15 + 6;
}

/* ------------------------------------------------------------------ */
/* Dựng file                                                           */
/* ------------------------------------------------------------------ */

const COLUMNS = [
  { header: 'STT', width: 5 },
  { header: 'Mã', width: 8 },
  { header: 'Phân loại phát hiện', width: 22 },
  { header: 'Đơn vị được đánh giá', width: 24 },
  { header: 'Nơi phát hiện', width: 20 },
  { header: 'Điều khoản', width: 18 },
  { header: 'Mô tả phát hiện', width: 60 },
  { header: 'Bằng chứng khách quan', width: 40 },
  // Độ rộng cột Excel tính theo ký tự: ~7 px một ký tự + 5 px lề.
  { header: 'Hình ảnh hiện trường', width: Math.ceil((PHOTO_COL_PX - 5) / 7) },
  { header: 'Thời hạn khắc phục', width: 14 },
  { header: 'Đánh giá viên', width: 20 },
  { header: 'Trạng thái', width: 18 },
];
const PHOTO_COL = 9; // cột I, đánh số từ 1
const LAST_COL = String.fromCharCode(64 + COLUMNS.length); // 'L'

export async function buildFindingsWorkbook(input: XlsxInput) {
  const { audit, rows, units, members } = input;
  const photos = input.photos ?? new Map<string, Buffer[]>();
  const photoCounts = input.photoCounts ?? new Map<string, number>();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Đánh giá nội bộ ISO';
  wb.created = new Date();

  /* ---------------- Sheet 1: danh sách finding ---------------- */

  const ws = wb.addWorksheet('Danh sách finding', {
    views: [{ state: 'frozen', ySplit: 5 }],
    // In ngang, vừa một trang bề ngang — bảng 12 cột in dọc là bị cắt.
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.mergeCells(`A1:${LAST_COL}1`);
  ws.getCell('A1').value = audit.title;
  ws.getCell('A1').font = { size: 14, bold: true };

  ws.mergeCells(`A2:${LAST_COL}2`);
  ws.getCell('A2').value =
    `Tổ chức được đánh giá: ${audit.organization}   ·   ` +
    `Thời gian: ${d(audit.startDate)} – ${d(audit.endDate)}   ·   ` +
    `Trưởng đoàn: ${audit.leadAuditor ?? ''}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };

  ws.mergeCells(`A3:${LAST_COL}3`);
  ws.getCell('A3').value = `Xuất ngày ${d(new Date())} · ${rows.length} finding`;
  ws.getCell('A3').font = { size: 9, italic: true, color: { argb: 'FF888888' } };

  ws.getRow(4).height = 6;

  const headerRow = ws.addRow(COLUMNS.map((c) => c.header));
  headerRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F45F5' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
  headerRow.height = 30;
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  for (const [i, f] of rows.entries()) {
    const clausesText = f.clauses.map((c) => `${c.standard} ${c.clause}`).join('\n');
    const statementText = f.statement ?? f.rawText;
    const evidenceText = f.evidence.map((e, n) => `${n + 1}. ${e}`).join('\n');

    const shown = photos.get(f.id)?.slice(0, MAX_PHOTOS) ?? [];
    const total = photoCounts.get(f.id) ?? shown.length;
    const extra = Math.max(0, total - shown.length);

    const row = ws.addRow([
      i + 1, // STT đánh lại liên tục — mã finding có thể nhảy số
      f.code ?? '',
      f.severity ? SEVERITY_LABELS[f.severity] : '',
      f.auditee ?? '',
      f.rawArea ?? '',
      clausesText,
      statementText,
      evidenceText,
      // Ô ảnh để trống, chỉ ghi chú khi có ảnh không chèn hết — ảnh nằm nổi bên trên.
      extra > 0 ? `+${extra} ảnh khác, xem trong app` : '',
      d(f.dueDate),
      f.auditorName ?? '',
      STATUS_LABELS[f.status] ?? f.status,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    const photoCell = row.getCell(PHOTO_COL);
    photoCell.alignment = { vertical: 'bottom', horizontal: 'center', wrapText: true };
    photoCell.font = { size: 9, italic: true, color: { argb: 'FF888888' } };

    // Tô đỏ nhạt cho Major, vàng nhạt cho Minor để nhìn lướt thấy ngay.
    const fill =
      f.severity === 'MAJOR' ? 'FFFDE8E8' : f.severity === 'MINOR' ? 'FFFEF6E0' : null;
    if (fill) {
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }

    /**
     * ĐẶT CHIỀU CAO CHO MỌI DÒNG, kể cả dòng không có ảnh.
     *
     * Ảnh neo theo ô, nhưng LibreOffice (và Excel ở vài bản) tính vị trí ảnh
     * TRƯỚC khi tự giãn những dòng không đặt chiều cao. Để một dòng tự giãn là
     * ảnh của mọi dòng bên dưới trượt lên dòng trên. Tự ước lượng cho tất cả
     * thì vị trí ảnh cố định, mở bằng phần mềm nào cũng như nhau.
     */
    const textPt = Math.max(
      18,
      textHeightPt(clausesText, COLUMNS[5].width),
      textHeightPt(statementText, COLUMNS[6].width),
      textHeightPt(evidenceText, COLUMNS[7].width),
      textHeightPt(f.rawArea ?? '', COLUMNS[4].width),
      textHeightPt(f.auditee ?? '', COLUMNS[3].width),
    );

    /* ---- Chèn ảnh: lưới 2 cột, tối đa 2 hàng ---- */
    const thumbs = (
      await Promise.all(shown.map((b) => makeThumb(b).catch(() => null)))
    ).filter((t): t is NonNullable<typeof t> => t !== null);

    const gridRows = Math.ceil(thumbs.length / 2);
    const photosPx = thumbs.length
      ? gridRows * THUMB_H + (gridRows + 1) * GAP + (extra > 0 ? 18 : 0)
      : 0;
    row.height = Math.max(photosPx * 0.75, textPt);

    thumbs.forEach((t, n) => {
      const gx = n % 2;
      const gy = Math.floor(n / 2);
      // Căn giữa ảnh trong ô lưới của nó (ảnh dọc hẹp hơn khung).
      const left = GAP + gx * (THUMB_W + GAP) + (THUMB_W - t.width) / 2;
      const top = GAP + gy * (THUMB_H + GAP) + (THUMB_H - t.height) / 2;

      const imageId = wb.addImage({ buffer: t.data as unknown as ExcelJS.Buffer, extension: 'jpeg' });
      ws.addImage(imageId, {
        /**
         * Neo bằng toạ độ GỐC (ô + độ lệch EMU), KHÔNG dùng toạ độ phân số
         * kiểu `{ col: 8.3, row: 6.1 }`. ExcelJS đổi phân số ra EMU bằng độ
         * rộng cột tính sai (width × 10 000, trong khi thật là ~7 px × 9 525
         * mỗi ký tự) — kết quả là ảnh chồng lên nhau và lệch sang dòng khác.
         */
        tl: {
          nativeCol: PHOTO_COL - 1,
          nativeColOff: Math.round(left * EMU_PER_PX),
          nativeRow: row.number - 1,
          nativeRowOff: Math.round(top * EMU_PER_PX),
        } as never,
        ext: { width: t.width, height: t.height },
        editAs: 'oneCell',
      });
    });
  }

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: COLUMNS.length } };

  /* ---------------- Sheet 2: tổng hợp theo đơn vị ---------------- */

  const ws2 = wb.addWorksheet('Tổng hợp');

  const sevKeys = ['MAJOR', 'MINOR', 'OBS', 'OFI', 'CONF'] as const;

  const h2 = ws2.addRow(['Đơn vị được đánh giá', ...sevKeys.map((s) => SEVERITY_LABELS[s]), 'Tổng']);
  h2.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F45F5' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  h2.height = 30;

  for (const u of units) {
    const ofUnit = rows.filter((f) => f.unitId === u.id);
    ws2.addRow([
      u.name,
      ...sevKeys.map((s) => ofUnit.filter((f) => f.severity === s).length),
      ofUnit.length,
    ]);
  }

  const totalRow = ws2.addRow([
    'TỔNG CỘNG',
    ...sevKeys.map((s) => rows.filter((f) => f.severity === s).length),
    rows.length,
  ]);
  totalRow.font = { bold: true };

  ws2.addRow([]);
  ws2.addRow(['Đánh giá viên', 'Số finding đã ghi nhận']).font = { bold: true };
  for (const m of members) {
    ws2.addRow([m.fullName, rows.filter((f) => f.memberId === m.id).length]);
  }

  ws2.columns = [{ width: 30 }, { width: 20 }, { width: 20 }, { width: 14 }, { width: 18 }, { width: 12 }, { width: 10 }];

  return wb;
}
