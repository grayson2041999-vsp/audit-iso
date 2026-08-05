import crypto from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { assignments, auditMembers, audits, type Audit, type AuditMember } from './schema';

/**
 * Phiên của đánh giá viên — vào bằng mã 6 số, không có tài khoản.
 *
 * Cookie đặt RIÊNG cho từng đợt (`am_<auditId>`), nên một người tham gia nhiều
 * đợt cùng lúc vẫn giữ được cả hai phiên, không đá nhau.
 */

const SESSION_DAYS = 45;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('Chưa cấu hình AUTH_SECRET.');
  return s;
}

function cookieName(auditId: string) {
  return `am_${auditId}`;
}

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export async function startMemberSession(auditId: string, memberId: string) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${memberId}.${exp}`;
  const jar = await cookies();
  jar.set(cookieName(auditId), `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endMemberSession(auditId: string) {
  const jar = await cookies();
  jar.delete(cookieName(auditId));
}

function readToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [memberId, expStr, sig] = parts;

  const expected = Buffer.from(sign(`${memberId}.${expStr}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length) return null;
  if (!crypto.timingSafeEqual(expected, given)) return null;
  if (Number(expStr) < Date.now()) return null;

  return memberId;
}

/**
 * Đánh giá viên đang đăng nhập vào đợt này, kèm đợt. Không ném lỗi.
 *
 * MỘT truy vấn JOIN, không phải hai lần nối tiếp. Trước đây hàm này lấy thành
 * viên xong mới lấy đợt — hai request HTTPS xuống Neon xếp hàng chờ nhau, trong
 * khi cả hai bảng đều tra theo khoá chính và ghép được trong một câu.
 *
 * ĐƯỢC BỌC BẰNG `cache()` CỦA REACT — phạm vi chỉ MỘT request. Mọi trang và
 * mọi route phía đánh giá viên đều mở đầu bằng `getMember(id)`, và các trang
 * còn gọi thêm `memberOwnsUnit` bên dưới, nên dedupe ở đây có lợi ở khắp nơi.
 *
 * ⚠️ Cùng cảnh báo như `getLeader`: phải là `cache` của 'react', không được
 * dùng `unstable_cache` hay biến toàn cục — sẽ rò phiên giữa những người dùng.
 */
export const getMember = cache(
  async (auditId: string): Promise<{ member: AuditMember; audit: Audit } | null> => {
    try {
      const jar = await cookies();
      const token = jar.get(cookieName(auditId))?.value;
      if (!token) return null;

      const memberId = readToken(token);
      if (!memberId) return null;

      const [row] = await db
        .select({ member: auditMembers, audit: audits })
        .from(auditMembers)
        .innerJoin(audits, eq(audits.id, auditMembers.auditId))
        .where(and(eq(auditMembers.id, memberId), eq(auditMembers.auditId, auditId)));

      return row ?? null;
    } catch {
      return null;
    }
  },
);

/**
 * Các đơn vị đã phân công cho đánh giá viên này.
 *
 * Cũng bọc `cache()`: `memberOwnsUnit` bên dưới đọc lại chính danh sách này,
 * nên trang đơn vị chỉ tốn một truy vấn cho cả việc kiểm quyền lẫn việc liệt kê.
 */
export const getMemberUnitIds = cache(async (auditId: string, memberId: string) => {
  const rows = await db
    .select({ unitId: assignments.unitId })
    .from(assignments)
    .where(and(eq(assignments.auditId, auditId), eq(assignments.memberId, memberId)));
  return rows.map((r) => r.unitId);
});

/**
 * Kiểm tra đánh giá viên có được giao đơn vị này không.
 *
 * Đọc từ danh sách đã cache thay vì bắn riêng một truy vấn đếm. Một đánh giá
 * viên được giao vài đơn vị trong một đợt nên danh sách này luôn rất ngắn.
 */
export async function memberOwnsUnit(auditId: string, memberId: string, unitId: string) {
  const unitIds = await getMemberUnitIds(auditId, memberId);
  return unitIds.includes(unitId);
}
