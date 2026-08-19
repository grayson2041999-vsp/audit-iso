-- =====================================================================
-- 011 — Nhật ký lượt gọi AI, dùng để giới hạn tần suất chuẩn hoá
--
-- Chạy TRƯỚC khi push code (chỉ thêm bảng mới, không đụng bảng cũ nên
-- bản deploy đang chạy không bị ảnh hưởng).
--
--   psql "$DATABASE_URL" -f db/migration-011-ai-usage.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- "member:<uuid>" hoặc "leader:<uuid>". Cố tình KHÔNG đặt khoá ngoại:
  -- đây là nhật ký chi phí, phải sống sót khi đánh giá viên bị xoá khỏi đợt
  -- hoặc cả đợt bị xoá. Xoá theo dây chuyền sẽ làm mất số liệu kế toán.
  actor_key   text NOT NULL,
  actor_name  text,
  audit_id    uuid,

  -- 'standardize'   — chuẩn hoá lần đầu từ màn hình ghi nhận
  -- 'restandardize' — chuẩn hoá lại một finding đã lưu nháp
  kind        text NOT NULL DEFAULT 'standardize',

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Truy vấn nóng: đếm số lượt của MỘT người trong MỘT giờ gần nhất.
CREATE INDEX IF NOT EXISTS ai_usage_actor_time_idx ON ai_usage (actor_key, created_at DESC);

-- Truy vấn nguội: thống kê chi phí theo đợt.
CREATE INDEX IF NOT EXISTS ai_usage_audit_idx ON ai_usage (audit_id, created_at DESC);
