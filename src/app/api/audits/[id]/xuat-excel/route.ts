import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditMembers, auditUnits, findings } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { SEVERITY_LABELS } from '@/lib/iso';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

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

/**
 * Xuất bảng tổng hợp ra .xlsx.
 * Bộ lọc đang bật trên màn hình được truyền qua tham số URL nên file tải về
 * khớp đúng những gì trưởng đoàn đang nhìn thấy.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  const { audit } = owned;

  const sp = new URL(req.url).searchParams;
  const conds: SQL[] = [eq(findings.auditId, id)];
  if (sp.get('unit')) conds.push(eq(findings.unitId, sp.get('unit')!));
  if (sp.get('member')) conds.push(eq(findings.memberId, sp.get('member')!));
  if (sp.get('severity')) conds.push(eq(findings.severity, sp.get('severity') as never));
  if (sp.get('status')) conds.push(eq(findings.status, sp.get('status') as never));

  const [rows, units, members] = await Promise.all([
    db.select().from(findings).where(and(...conds)).orderBy(asc(findings.code)),
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
    db.select().from(auditMembers).where(eq(auditMembers.auditId, id)),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Đánh giá nội bộ ISO';
  wb.created = new Date();

  /* ---------------- Sheet 1: danh sách finding ---------------- */

  const ws = wb.addWorksheet('Danh sách finding', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = audit.title;
  ws.getCell('A1').font = { size: 14, bold: true };

  ws.mergeCells('A2:K2');
  ws.getCell('A2').value =
    `Mã đợt: ${audit.code}   ·   Thời gian: ${d(audit.startDate)} – ${d(audit.endDate)}   ·   ` +
    `Trưởng đoàn: ${audit.leadAuditor ?? ''}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };

  ws.mergeCells('A3:K3');
  ws.getCell('A3').value = `Xuất ngày ${d(new Date())} · ${rows.length} finding`;
  ws.getCell('A3').font = { size: 9, italic: true, color: { argb: 'FF888888' } };

  ws.getRow(4).height = 6;

  const header = [
    'STT', 'Mã', 'Phân loại phát hiện', 'Đơn vị được đánh giá', 'Nơi phát hiện',
    'Điều khoản', 'Mô tả phát hiện', 'Bằng chứng khách quan', 'Thời hạn khắc phục',
    'Đánh giá viên', 'Trạng thái',
  ];
  const headerRow = ws.addRow(header);
  headerRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F45F5' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
  headerRow.height = 30;

  rows.forEach((f, i) => {
    const row = ws.addRow([
      i + 1, // STT đánh lại liên tục — mã finding có thể nhảy số
      f.code ?? '',
      f.severity ? SEVERITY_LABELS[f.severity] : '',
      f.auditee ?? '',
      f.rawArea ?? '',
      f.clauses.map((c) => `${c.standard} ${c.clause}`).join('\n'),
      f.statement ?? f.rawText,
      f.evidence.map((e, n) => `${n + 1}. ${e}`).join('\n'),
      d(f.dueDate),
      f.auditorName ?? '',
      STATUS_LABELS[f.status] ?? f.status,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };

    // Tô đỏ nhạt cho Major, vàng nhạt cho Minor để nhìn lướt thấy ngay.
    const fill =
      f.severity === 'MAJOR' ? 'FFFDE8E8' : f.severity === 'MINOR' ? 'FFFEF6E0' : null;
    if (fill) {
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }
  });

  ws.columns = [
    { width: 5 }, { width: 8 }, { width: 22 }, { width: 24 }, { width: 20 },
    { width: 18 }, { width: 60 }, { width: 40 }, { width: 14 }, { width: 20 }, { width: 18 },
  ];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: header.length } };

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

  /* ---------------- Trả file ---------------- */

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `${audit.code.replace(/[^\w-]/g, '_')}_tong-hop-finding.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
