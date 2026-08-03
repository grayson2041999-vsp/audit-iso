import crypto from 'node:crypto';
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

/** Đánh giá viên đang đăng nhập vào đợt này, kèm đợt. Không ném lỗi. */
export async function getMember(
  auditId: string,
): Promise<{ member: AuditMember; audit: Audit } | null> {
  try {
    const jar = await cookies();
    const token = jar.get(cookieName(auditId))?.value;
    if (!token) return null;

    const memberId = readToken(token);
    if (!memberId) return null;

    const [member] = await db
      .select()
      .from(auditMembers)
      .where(and(eq(auditMembers.id, memberId), eq(auditMembers.auditId, auditId)));
    if (!member) return null;

    const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
    if (!audit) return null;

    return { member, audit };
  } catch {
    return null;
  }
}

/** Các đơn vị đã phân công cho đánh giá viên này. */
export async function getMemberUnitIds(auditId: string, memberId: string) {
  const rows = await db
    .select({ unitId: assignments.unitId })
    .from(assignments)
    .where(and(eq(assignments.auditId, auditId), eq(assignments.memberId, memberId)));
  return rows.map((r) => r.unitId);
}

/** Kiểm tra đánh giá viên có được giao đơn vị này không. */
export async function memberOwnsUnit(auditId: string, memberId: string, unitId: string) {
  const [row] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.auditId, auditId),
        eq(assignments.memberId, memberId),
        eq(assignments.unitId, unitId),
      ),
    );
  return Boolean(row);
}
