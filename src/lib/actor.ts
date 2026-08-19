import { getMember } from './member-auth';
import { getLeader } from './auth';
import { getOwnedAudit } from './audit-access';

/**
 * "Anh là ai?" — lớp xác thực dùng chung cho các route tiêu tài nguyên trả tiền.
 *
 * Ban đầu hàm này nằm trong `ai-quota.ts` vì chỉ `/api/standardize` cần. Nay
 * `/api/uploads/presign` cũng phải hỏi cùng câu đó, nên tách ra đứng riêng —
 * để route upload không phải import từ một file tên là "ai-quota", đọc vào
 * tưởng nhầm là có gọi AI.
 *
 * Hai loại người dùng của app không chung một kiểu phiên:
 *   · Đánh giá viên — cookie `am_<auditId>`, đặt RIÊNG theo từng đợt
 *   · Trưởng đoàn   — cookie `audit_session`, một cái cho mọi đợt
 *
 * Vì cookie đánh giá viên gắn với đợt, MỌI lời gọi tới đây đều phải kèm
 * `auditId` — không biết đợt thì không biết tra cookie nào.
 */

export type Actor = {
  kind: 'member' | 'leader';
  /** UUID trong bảng `audit_members` hoặc `leaders`. */
  id: string;
  /** Khoá định danh phẳng để đếm hạn mức và đặt tên file: "member:<uuid>". */
  key: string;
  name: string;
  auditId: string;
  /** Đợt đã khoá thì không cho ghi thêm gì nữa. */
  auditClosed: boolean;
};

/**
 * Trả về người gọi, hoặc `null` nếu không phải ai cả.
 *
 * Thử đánh giá viên trước, trưởng đoàn sau — đường dùng chính là đánh giá viên
 * ghi nhận tại hiện trường. Trưởng đoàn được chấp nhận để còn thử nghiệm và
 * xử lý giúp khi cần, nhưng CHỈ trong đợt của chính mình (`getOwnedAudit`).
 *
 * Cố tình không phân biệt "không đăng nhập" với "đăng nhập nhưng không có
 * quyền vào đợt này" — cùng trả `null`, để không lộ sự tồn tại của đợt.
 */
export async function resolveActor(auditId: string): Promise<Actor | null> {
  const session = await getMember(auditId);
  if (session) {
    return {
      kind: 'member',
      id: session.member.id,
      key: `member:${session.member.id}`,
      name: session.member.fullName,
      auditId,
      auditClosed: session.audit.status === 'CLOSED',
    };
  }

  const leader = await getLeader();
  if (!leader) return null;

  const owned = await getOwnedAudit(auditId);
  if (!owned) return null;

  return {
    kind: 'leader',
    id: leader.id,
    key: `leader:${leader.id}`,
    name: leader.fullName,
    auditId,
    auditClosed: owned.audit.status === 'CLOSED',
  };
}
