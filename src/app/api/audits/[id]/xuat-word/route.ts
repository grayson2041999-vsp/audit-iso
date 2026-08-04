import { NextResponse } from 'next/server';
import {
  AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell,
  TableRow, TextRun, WidthType,
} from 'docx';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, auditMembers, auditSessions, auditUnits } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { STANDARD_SHORT, type StandardCode } from '@/lib/iso';
import { KIND_LABELS, formatDayLong, listDays, toMinutes } from '@/lib/plan';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const FONT = 'Times New Roman';
const GRAY = 'DDDDDD';

const dmy = (x: Date | null) =>
  x
    ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(x)
    : '';

/* ------------------------------------------------------------------ */
/* Khối dựng sẵn                                                       */
/* ------------------------------------------------------------------ */

function p(text: string, opts: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; italics?: boolean } = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.after ?? 100 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: opts.size ?? 24, // 24 half-point = 12pt
        font: FONT,
      }),
    ],
  });
}

/** Đoạn nhiều dòng: mỗi dòng trong chuỗi nguồn thành một gạch đầu dòng. */
function bullets(text: string | null) {
  const lines = (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [p('—')];
  return lines.map(
    (l) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: [new TextRun({ text: l, size: 24, font: FONT })],
      }),
  );
}

function cell(text: string, opts: { bold?: boolean; width?: number; shade?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { fill: opts.shade } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: text.split('\n').map(
      (line) =>
        new Paragraph({
          alignment: opts.align,
          spacing: { after: 0 },
          children: [new TextRun({ text: line, bold: opts.bold, size: 22, font: FONT })],
        }),
    ),
  });
}

function table(rows: TableRow[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
      left: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
      right: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: GRAY },
    },
    rows,
  });
}

/* ------------------------------------------------------------------ */

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  const { audit } = owned;

  const [units, members, links, sessions] = await Promise.all([
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)),
    db
      .select()
      .from(auditMembers)
      .where(eq(auditMembers.auditId, id))
      .orderBy(asc(auditMembers.createdAt)),
    db.select().from(assignments).where(eq(assignments.auditId, id)),
    db.select().from(auditSessions).where(eq(auditSessions.auditId, id)),
  ]);

  const unitById = new Map(units.map((u) => [u.id, u]));
  const memberById = new Map(members.map((m) => [m.id, m]));

  /** Đơn vị → đánh giá viên phụ trách. */
  const unitMembers = new Map<string, string[]>();
  /** Đánh giá viên → đơn vị được giao. */
  const memberUnits = new Map<string, string[]>();
  for (const l of links) {
    unitMembers.set(l.unitId, [...(unitMembers.get(l.unitId) ?? []), l.memberId]);
    memberUnits.set(l.memberId, [...(memberUnits.get(l.memberId) ?? []), l.unitId]);
  }

  const days = listDays(audit.startDate, audit.endDate);
  const standards = audit.standards
    .map((s) => STANDARD_SHORT[s as StandardCode] ?? s)
    .join('; ');

  /* ---------------- Thân tài liệu ---------------- */

  const body: (Paragraph | Table)[] = [];

  body.push(
    p(audit.organization.toUpperCase(), { bold: true, align: AlignmentType.CENTER, after: 60 }),
    p('CHƯƠNG TRÌNH ĐÁNH GIÁ NỘI BỘ', {
      bold: true, size: 32, align: AlignmentType.CENTER, after: 60,
    }),
    p(audit.title, { align: AlignmentType.CENTER, italics: true, after: 300 }),
  );

  /* 1. Thông tin chung */
  body.push(p('1. THÔNG TIN CHUNG', { bold: true }));
  body.push(
    table([
      new TableRow({
        children: [cell('Tổ chức được đánh giá', { bold: true, width: 30, shade: 'F1F5F9' }), cell(audit.organization)],
      }),
      new TableRow({
        children: [cell('Tên đợt đánh giá', { bold: true, shade: 'F1F5F9' }), cell(audit.title)],
      }),
      new TableRow({
        children: [
          cell('Thời gian', { bold: true, shade: 'F1F5F9' }),
          cell(`${dmy(audit.startDate)} – ${dmy(audit.endDate)}   (${days.length} ngày)`),
        ],
      }),
      new TableRow({
        children: [cell('Địa điểm', { bold: true, shade: 'F1F5F9' }), cell(audit.location ?? '—')],
      }),
      new TableRow({
        children: [
          cell('Trưởng đoàn đánh giá', { bold: true, shade: 'F1F5F9' }),
          cell(audit.leadAuditor ?? '—'),
        ],
      }),
      new TableRow({
        children: [cell('Tiêu chuẩn áp dụng', { bold: true, shade: 'F1F5F9' }), cell(standards || '—')],
      }),
    ]),
    p('', { after: 200 }),
  );

  /* 2–4. Mục tiêu, phạm vi, chuẩn mực */
  body.push(p('2. MỤC TIÊU ĐÁNH GIÁ', { bold: true }), ...bullets(audit.objectives), p('', { after: 100 }));
  body.push(p('3. PHẠM VI ĐÁNH GIÁ', { bold: true }), ...bullets(audit.scope), p('', { after: 100 }));
  body.push(p('4. CHUẨN MỰC ĐÁNH GIÁ', { bold: true }), ...bullets(audit.criteria), p('', { after: 200 }));

  /* 5. Đoàn đánh giá */
  body.push(p('5. ĐOÀN ĐÁNH GIÁ', { bold: true }));
  body.push(
    table([
      new TableRow({
        tableHeader: true,
        children: [
          cell('TT', { bold: true, width: 6, shade: 'F1F5F9', align: AlignmentType.CENTER }),
          cell('Họ và tên', { bold: true, width: 24, shade: 'F1F5F9' }),
          cell('Vai trò', { bold: true, width: 18, shade: 'F1F5F9' }),
          cell('Đơn vị công tác', { bold: true, width: 22, shade: 'F1F5F9' }),
          cell('Đơn vị được phân công', { bold: true, width: 30, shade: 'F1F5F9' }),
        ],
      }),
      ...members.map((m, i) =>
        new TableRow({
          children: [
            cell(String(i + 1), { align: AlignmentType.CENTER }),
            cell(m.fullName),
            cell(m.fullName === audit.leadAuditor || m.isLeader === '1' ? 'Trưởng đoàn' : 'Đánh giá viên'),
            cell(m.homeUnit ?? '—'),
            cell(
              (memberUnits.get(m.id) ?? [])
                .map((u) => unitById.get(u)?.name)
                .filter(Boolean)
                .join('\n') || '—',
            ),
          ],
        }),
      ),
    ]),
    p('', { after: 200 }),
  );

  /* 6. Lịch đánh giá — mỗi ngày một bảng */
  body.push(p('6. LỊCH ĐÁNH GIÁ CHI TIẾT', { bold: true }));

  if (days.length === 0 || sessions.length === 0) {
    body.push(p('Chưa lập lịch đánh giá.', { italics: true }));
  } else {
    days.forEach((day, dayIndex) => {
      const inDay = sessions
        .filter((x) => x.day === day)
        .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

      if (inDay.length === 0) return;

      const rows: TableRow[] = [
        new TableRow({
          tableHeader: true,
          children: [
            cell('Thời gian', { bold: true, width: 20, shade: 'F1F5F9' }),
            cell('Đơn vị / Nội dung', { bold: true, width: 44, shade: 'F1F5F9' }),
            cell('Đánh giá viên', { bold: true, width: 36, shade: 'F1F5F9' }),
          ],
        }),
        ...inDay.map((x) => {
          const unit = x.unitId ? unitById.get(x.unitId) : null;
          /**
           * Phiên đơn vị ghi đích danh người được phân công — đó là thông tin
           * đơn vị cần biết để bố trí người tiếp.
           *
           * Phiên họp thì cả đoàn dự, chép lại danh sách vừa dài vừa thừa: mục
           * 5 phía trên đã liệt kê đầy đủ đoàn đánh giá rồi.
           */
          const names =
            x.kind === 'UNIT'
              ? (x.unitId ? unitMembers.get(x.unitId) ?? [] : [])
                  .map((m) => memberById.get(m)?.fullName)
                  .filter(Boolean)
                  .join('\n')
              : 'Đoàn đánh giá';

          return new TableRow({
            children: [
              cell(`${x.startTime} – ${x.endTime}`),
              cell(x.kind === 'UNIT' ? unit?.name ?? '—' : KIND_LABELS[x.kind], {
                bold: x.kind !== 'UNIT',
              }),
              cell(names || '—'),
            ],
          });
        }),
      ];

      body.push(
        p(`Ngày ${dayIndex + 1} — ${formatDayLong(day)}`, { bold: true, after: 60 }),
        table(rows),
        p('', { after: 160 }),
      );
    });
  }

  /* 7. Lưu ý */
  body.push(
    p('7. LƯU Ý CHUNG', { bold: true }),
    ...bullets(
      [
        'Lịch đánh giá có thể điều chỉnh linh hoạt tại hiện trường theo thoả thuận giữa trưởng đoàn và đơn vị được đánh giá.',
        'Đại diện đơn vị bố trí có mặt trong suốt buổi đánh giá và chuẩn bị sẵn hồ sơ, tài liệu liên quan.',
        'Mọi phát hiện được trao đổi và thống nhất với đơn vị ngay trong buổi đánh giá trước khi ghi nhận chính thức.',
      ].join('\n'),
    ),
    p('', { after: 300 }),
  );

  /* 8. Khối ký */
  body.push(
    table([
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            },
            children: [
              p('TRƯỞNG ĐOÀN ĐÁNH GIÁ', { bold: true, align: AlignmentType.CENTER, after: 800 }),
              p(audit.leadAuditor ?? '', { bold: true, align: AlignmentType.CENTER }),
            ],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            },
            children: [
              p((audit.approverTitle || 'NGƯỜI PHÊ DUYỆT').toLocaleUpperCase('vi'), {
                bold: true, align: AlignmentType.CENTER, after: 800,
              }),
              p(audit.approverName ?? '', { bold: true, align: AlignmentType.CENTER }),
            ],
          }),
        ],
      }),
    ]),
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
        properties: {
          page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 900 } },
        },
        children: body,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  const slug = audit.organization
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${slug || 'chuong-trinh'}_chuong-trinh-danh-gia.docx"`,
      'Cache-Control': 'no-store',
    },
  });
}
