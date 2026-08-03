import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { audits, type Audit, type Leader } from './schema';
import { getLeader } from './auth';

/**
 * Lấy đợt đánh giá và kiểm tra quyền sở hữu trong một bước.
 * Trả về `null` nếu chưa đăng nhập hoặc đợt không thuộc về người này —
 * cố tình không phân biệt hai trường hợp để không lộ sự tồn tại của đợt.
 */
export async function getOwnedAudit(
  auditId: string,
): Promise<{ leader: Leader; audit: Audit } | null> {
  const leader = await getLeader();
  if (!leader) return null;

  try {
    const [audit] = await db
      .select()
      .from(audits)
      .where(and(eq(audits.id, auditId), eq(audits.leaderId, leader.id)));
    return audit ? { leader, audit } : null;
  } catch {
    return null;
  }
}

export const AUDIT_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Đang chuẩn bị',
  IN_PROGRESS: 'Đang thực hiện',
  REPORTING: 'Đang tổng hợp',
  CLOSED: 'Đã khoá',
};

export const AUDIT_STATUS_STYLE: Record<string, string> = {
  PLANNED: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-800',
  REPORTING: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-zinc-200 text-zinc-700',
};

/**
 * Lưu ý: file này kéo theo `auth.ts` (dùng `next/headers`) nên CHỈ được nhập
 * từ phía máy chủ. Hàm dùng chung với component trình duyệt đặt ở `utils.ts`.
 */

/** Sinh mã 6 số, tránh trùng với các mã đã cấp trong cùng đợt. */
export function generateAccessCode(taken: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  throw new Error('Không sinh được mã mới, vui lòng thử lại.');
}

