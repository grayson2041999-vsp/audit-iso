/**
 * Seed dữ liệu mẫu: npx tsx scripts/seed.ts
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { audits, findings, leaders } from '../src/lib/schema';

import { hashPassword } from '../src/lib/auth';

const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  // Tài khoản trưởng đoàn mẫu — mật khẩu: matkhau123
  const [leader] = await db
    .insert(leaders)
    .values({
      email: 'truongdoan@example.com',
      fullName: 'Nguyễn Văn A',
      passwordHash: hashPassword('matkhau123'),
    })
    .returning();

  const [audit] = await db
    .insert(audits)
    .values({
      leaderId: leader.id,
      organization: 'Xí nghiệp Dịch vụ Cảng và Cung ứng vật tư thiết bị',
      title: 'Đánh giá nội bộ định kỳ Quý III/2026',
      scope: 'Toàn bộ các quá trình thuộc phạm vi HTQL tích hợp',
      standards: ['ISO9001', 'ISO14001', 'ISO45001'],
      leadAuditor: 'Nguyễn Văn A',
      status: 'IN_PROGRESS',
    })
    .returning();

  await db.insert(findings).values({
    auditId: audit.id,
    code: 'NC-001',
    status: 'REVIEWED',
    rawText:
      'Kho vật tư tầng 1: kiểm tra 8 bình chữa cháy, 3 bình (BCC-04, BCC-07, BCC-11) tem kiểm định hết hạn từ 02/2026. Thủ kho không xuất trình được sổ theo dõi kiểm tra hàng tháng 6 tháng gần đây.',
    rawArea: 'Kho vật tư tầng 1',
    auditorName: 'Nguyễn Văn A',
    standards: ['ISO45001'],
    title: 'Bình chữa cháy hết hiệu lực kiểm định và thiếu hồ sơ kiểm tra định kỳ',
    severity: 'MAJOR',
    evidence: [
      'Kiểm tra 8/8 bình chữa cháy tại kho vật tư tầng 1 ngày đánh giá',
      '3 bình mã BCC-04, BCC-07, BCC-11 có tem kiểm định hết hiệu lực từ tháng 02/2026',
      'Không xuất trình được sổ theo dõi kiểm tra hằng tháng trong 6 tháng gần nhất',
    ],
    statement:
      'Tại kho vật tư tầng 1, 3/8 bình chữa cháy được kiểm tra (mã BCC-04, BCC-07, BCC-11) có tem kiểm định hết hiệu lực từ tháng 02/2026 và không có hồ sơ kiểm tra định kỳ trong 6 tháng gần nhất. Điều này không phù hợp với yêu cầu tại điều khoản 8.2 của ISO 45001:2018 và Thủ tục QT-PCCC-01 mục 5.3 quy định bình chữa cháy phải được kiểm tra hằng tháng và lưu hồ sơ. Tổ chức chưa duy trì được việc kiểm tra định kỳ và thông tin dạng văn bản làm bằng chứng cho hoạt động chuẩn bị sẵn sàng ứng phó khẩn cấp.',
    clauses: [
      { standard: 'ISO 45001:2018', clause: '8.2', clauseTitle: 'Chuẩn bị sẵn sàng và ứng phó tình huống khẩn cấp' },
      { standard: 'ISO 45001:2018', clause: '7.5', clauseTitle: 'Thông tin dạng văn bản' },
    ],
    missingInfo: ['Ngày kiểm tra thực tế', 'Số hiệu và ngày ban hành của QT-PCCC-01'],
    aiModel: 'claude-sonnet-5',
  });

  console.log('Đã seed dữ liệu mẫu.');
}

main();
