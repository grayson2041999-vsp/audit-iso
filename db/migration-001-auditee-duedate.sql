-- =====================================================================
-- Migration 001: thêm "Đơn vị được đánh giá" và "Thời hạn khắc phục"
-- Chạy MỘT LẦN trên Neon SQL Editor (an toàn nếu chạy lại nhiều lần).
-- =====================================================================

ALTER TABLE findings ADD COLUMN IF NOT EXISTS auditee  text;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS due_date timestamptz;

CREATE INDEX IF NOT EXISTS findings_due_date_idx ON findings(due_date);
