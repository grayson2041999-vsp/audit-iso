import crypto from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { auditUnits, audits, type Audit, type AuditUnit } from './schema';

/**
 * Phiên của ĐƠN VỊ ĐƯỢC ĐÁNH GIÁ — vào bằng mã 8 số, không có tài khoản.
 *
 * Dựng theo đúng khuôn của `member-auth.ts`, chỉ khác chủ thể: cookie đặt riêng
 * cho từng đợt (`ur_<auditId>`) nên một đơn vị bị đánh giá ở nhiều đợt vẫn giữ
 * được cả hai phiên.
 *
 * Khác biệt duy nhất đáng chú ý so với đánh giá viên: chủ thể ở đây là một TẬP
 * THỂ, không phải một người. Mã dùng chung cả phòng, nên không suy ra được ai
 * đang thao tác — vì vậy `corrective_reports` bắt nhập họ tên và chức danh
 * lãnh đạo đơn vị lúc nộp, đó mới là chỗ ghi trách nhiệm.
 */

const SESSION_DAYS = 120; // Dài hơn phiên đánh giá viên: khắc phục kéo 30–60 ngày.

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('Chưa cấu hình AUTH_SECRET.');
  return s;
}

function cookieName(auditId: string) {
  return `ur_${auditId}`;
}

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export async function startUnitSession(auditId: string, unitId: string) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${unitId}.${exp}`;
  const jar = await cookies();
  jar.set(cookieName(auditId), `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endUnitSession(auditId: string) {
  const jar = await cookies();
  jar.delete(cookieName(auditId));
}

function readToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [unitId, expStr, sig] = parts;

  const expected = Buffer.from(sign(`${unitId}.${expStr}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length) return null;
  if (!crypto.timingSafeEqual(expected, given)) return null;
  if (Number(expStr) < Date.now()) return null;

  return unitId;
}

/**
 * Đơn vị đang đăng nhập vào đợt này, kèm đợt. Không ném lỗi.
 *
 * ⚠️ Cùng cảnh báo như `getLeader` và `getMember`: phải là `cache` của 'react'
 * (phạm vi một request), TUYỆT ĐỐI không dùng `unstable_cache` hay biến toàn
 * cục — sẽ rò phiên giữa những người dùng khác nhau.
 */
export const getUnitSession = cache(
  async (auditId: string): Promise<{ unit: AuditUnit; audit: Audit } | null> => {
    try {
      const jar = await cookies();
      const token = jar.get(cookieName(auditId))?.value;
      if (!token) return null;

      const unitId = readToken(token);
      if (!unitId) return null;

      const [row] = await db
        .select({ unit: auditUnits, audit: audits })
        .from(auditUnits)
        .innerJoin(audits, eq(audits.id, auditUnits.auditId))
        .where(and(eq(auditUnits.id, unitId), eq(auditUnits.auditId, auditId)));

      if (!row) return null;

      /**
       * Chưa phát hành thì phiên coi như không có. Chặn ở đây phòng trường hợp
       * trưởng đoàn lỡ tay phát hành rồi cần rút lại toàn bộ: xoá `issued_at`
       * là mọi phiên đơn vị hết hiệu lực ngay, không phải đi thu hồi từng cookie.
       */
      if (!row.audit.issuedAt) return null;

      return row;
    } catch {
      return null;
    }
  },
);
