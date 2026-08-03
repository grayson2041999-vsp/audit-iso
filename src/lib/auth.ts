import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { leaders, type Leader } from './schema';

/**
 * Xác thực trưởng đoàn — tự viết bằng thư viện crypto có sẵn của Node,
 * không thêm phụ thuộc nào.
 *
 *  · Mật khẩu: PBKDF2-SHA256, 210.000 vòng, muối ngẫu nhiên 16 byte.
 *  · Phiên  : cookie httpOnly chứa "leaderId.hạn.chữ_ký", ký bằng HMAC-SHA256.
 *             Không lưu phiên trong database — hết hạn là hết, không thu hồi
 *             được từng phiên. Đủ cho phạm vi sử dụng nội bộ.
 */

const COOKIE_NAME = 'audit_session';
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 210_000;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Chưa cấu hình AUTH_SECRET (chuỗi ngẫu nhiên tối thiểu 16 ký tự) trong biến môi trường.',
    );
  }
  return s;
}

export function isAuthConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16);
}

/* ------------------------------------------------------------------ */
/* Mật khẩu                                                            */
/* ------------------------------------------------------------------ */

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(plain, salt, PBKDF2_ROUNDS, 32, 'sha256');
  return `pbkdf2$${PBKDF2_ROUNDS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, roundsStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;

  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.pbkdf2Sync(
    plain,
    Buffer.from(saltB64, 'base64'),
    Number(roundsStr),
    expected.length,
    'sha256',
  );
  // So sánh thời gian hằng số để không rò rỉ thông tin qua thời gian phản hồi.
  return crypto.timingSafeEqual(expected, actual);
}

/* ------------------------------------------------------------------ */
/* Phiên đăng nhập                                                     */
/* ------------------------------------------------------------------ */

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function buildToken(leaderId: string) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${leaderId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [leaderId, expStr, sig] = parts;
  const payload = `${leaderId}.${expStr}`;

  const expectedSig = Buffer.from(sign(payload));
  const givenSig = Buffer.from(sig);
  if (expectedSig.length !== givenSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, givenSig)) return null;

  if (Number(expStr) < Date.now()) return null;
  return leaderId;
}

export async function startSession(leaderId: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, buildToken(leaderId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Trả về trưởng đoàn đang đăng nhập, hoặc null. Không ném lỗi. */
export async function getLeader(): Promise<Leader | null> {
  if (!isAuthConfigured()) return null;
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const leaderId = readToken(token);
    if (!leaderId) return null;

    const [row] = await db.select().from(leaders).where(eq(leaders.id, leaderId));
    return row ?? null;
  } catch {
    return null;
  }
}
