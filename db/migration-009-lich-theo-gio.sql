-- =====================================================================
-- Migration 009: lịch đánh giá theo giờ cụ thể
--
-- Thay mô hình "một buổi một phiên" bằng giờ bắt đầu – giờ kết thúc,
-- thêm thời lượng họp khai mạc / kết thúc, bỏ cột đại diện đơn vị.
--
-- ⚠️  Có XOÁ cột → PHẢI push code mới TRƯỚC, đợi Vercel build xong,
--     rồi mới chạy file này.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Giờ của từng phiên
-- --------------------------------------------------------------------
ALTER TABLE audit_sessions ADD COLUMN IF NOT EXISTS start_time text;
ALTER TABLE audit_sessions ADD COLUMN IF NOT EXISTS end_time   text;

-- Lịch cũ (nếu có) đang lưu theo buổi — quy đổi sang khung giờ tương ứng.
UPDATE audit_sessions SET
  start_time = COALESCE(start_time, CASE WHEN half::text = 'AM' THEN '08:00' ELSE '13:30' END),
  end_time   = COALESCE(end_time,   CASE WHEN half::text = 'AM' THEN '11:30' ELSE '17:00' END)
WHERE start_time IS NULL OR end_time IS NULL;

ALTER TABLE audit_sessions ALTER COLUMN start_time SET NOT NULL;
ALTER TABLE audit_sessions ALTER COLUMN end_time   SET NOT NULL;
ALTER TABLE audit_sessions DROP COLUMN IF EXISTS half;

DROP INDEX IF EXISTS audit_sessions_day_idx;
CREATE INDEX IF NOT EXISTS audit_sessions_day_idx ON audit_sessions(audit_id, day, start_time);

-- --------------------------------------------------------------------
-- 2. Thời lượng hai cuộc họp cố định
-- --------------------------------------------------------------------
ALTER TABLE audits ADD COLUMN IF NOT EXISTS opening_minutes integer NOT NULL DEFAULT 30;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS closing_minutes integer NOT NULL DEFAULT 90;

-- --------------------------------------------------------------------
-- 3. Bỏ đại diện đơn vị
-- --------------------------------------------------------------------
ALTER TABLE audit_units DROP COLUMN IF EXISTS contact_person;

-- --------------------------------------------------------------------
-- 4. Kiểm tra
-- --------------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_name = 'audit_sessions' ORDER BY ordinal_position;
