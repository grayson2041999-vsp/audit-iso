import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { aiUsage } from './schema';
import type { Actor } from './actor';

/**
 * Giới hạn số lượt gọi AI của một người trong một giờ.
 *
 * Đây là lớp bảo vệ THỨ HAI. Lớp thứ nhất — "anh là ai" — nằm ở `actor.ts` và
 * chặn người lạ; lớp này chặn người hợp lệ dùng quá tay (bấm chuẩn hoá hàng
 * trăm lần, hoặc mã 6 số lọt ra ngoài). Thiếu một trong hai đều không đủ.
 */

/** Số lượt chuẩn hoá tối đa của MỘT người trong MỘT giờ. */
export const AI_HOURLY_LIMIT = Number(process.env.AI_HOURLY_LIMIT ?? 20);

const WINDOW_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 2. Còn lượt không?                                                  */
/* ------------------------------------------------------------------ */

export type QuotaResult =
  | { ok: true; remaining: number }
  | { ok: false; message: string; retryAfterSeconds: number };

/**
 * Đếm số lượt đã dùng trong 60 phút gần nhất theo kiểu CỬA SỔ TRƯỢT.
 *
 * Không dùng "mỗi đầu giờ reset về 0" vì kiểu đó cho phép dồn 40 lượt vào hai
 * phút quanh mốc chuyển giờ. Cửa sổ trượt thì lượt cũ nhất rụng dần, người
 * dùng bình thường không bao giờ chạm trần.
 *
 * Một truy vấn lấy cả số lượt lẫn thời điểm lượt cũ nhất — có thời điểm đó mới
 * nói được "thử lại sau bao lâu" thay vì câu chung chung "hết lượt rồi".
 */
export async function checkAiQuota(actorKey: string): Promise<QuotaResult> {
  const since = new Date(Date.now() - WINDOW_MS);

  let used = 0;
  let oldestMs: number | null = null;

  try {
    const [row] = await db
      .select({
        // ::int là bắt buộc — count(*) trả về bigint, và driver đưa bigint về
        // dạng CHUỖI chứ không phải số, nên thiếu ép kiểu là mọi phép so sánh
        // bên dưới đều sai một cách âm thầm.
        used: sql<number>`count(*)::int`,
        // Trả về mili-giây thay vì timestamp: tránh phải đoán driver đưa về
        // Date hay chuỗi ISO. Số thì đằng nào cũng là số.
        oldestMs: sql<number | null>`(extract(epoch from min(${aiUsage.createdAt})) * 1000)::bigint::float8`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.actorKey, actorKey), gte(aiUsage.createdAt, since)));

    used = Number(row?.used ?? 0);
    oldestMs = row?.oldestMs == null ? null : Number(row.oldestMs);
  } catch (e) {
    /**
     * FAIL-OPEN CÓ CHỦ ĐÍCH. Bảng nhật ký hỏng thì cho qua, không chặn công việc
     * của đánh giá viên đang đứng ngoài hiện trường. Rủi ro chi phí đã được lớp
     * xác thực ở trên gánh phần lớn — không còn là cửa mở cho người lạ nữa.
     */
    console.error('[ai-quota] Không đếm được lượt, tạm cho qua:', e);
    return { ok: true, remaining: AI_HOURLY_LIMIT };
  }

  if (used < AI_HOURLY_LIMIT) {
    return { ok: true, remaining: AI_HOURLY_LIMIT - used };
  }

  // Lượt cũ nhất rụng khỏi cửa sổ lúc nào thì lúc đó có lại một lượt.
  const freeAt = (oldestMs && Number.isFinite(oldestMs) ? oldestMs : Date.now()) + WINDOW_MS;
  const retryAfterSeconds = Math.max(60, Math.ceil((freeAt - Date.now()) / 1000));
  const minutes = Math.ceil(retryAfterSeconds / 60);

  return {
    ok: false,
    retryAfterSeconds,
    message:
      `Bạn đã dùng hết ${AI_HOURLY_LIMIT} lượt chuẩn hoá trong một giờ. ` +
      `Vui lòng thử lại sau khoảng ${minutes} phút. ` +
      'Trong lúc chờ vẫn lưu nháp được ghi nhận thô và chuẩn hoá sau.',
  };
}

/**
 * Ghi nhận một lượt đã dùng. Gọi SAU khi AI trả kết quả thành công —
 * lời gọi hỏng thì không tính vào hạn mức của người dùng.
 *
 * Lỗi ghi nhật ký không được làm hỏng phản hồi: kết quả chuẩn hoá đã có trong
 * tay rồi, ném lỗi ở đây là ném đi công việc vừa làm xong.
 */
export async function recordAiUsage(
  actor: Actor,
  kind: 'standardize' | 'restandardize' = 'standardize',
) {
  try {
    await db.insert(aiUsage).values({
      actorKey: actor.key,
      actorName: actor.name,
      auditId: actor.auditId,
      kind,
    });
  } catch (e) {
    console.error('[ai-quota] Không ghi được nhật ký lượt gọi:', e);
  }
}
