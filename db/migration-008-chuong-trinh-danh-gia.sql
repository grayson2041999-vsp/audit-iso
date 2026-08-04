-- =====================================================================
-- Migration 008: Chương trình đánh giá (audit plan)
--
-- Chỉ THÊM bảng, cột và kiểu enum → chạy trước khi push là an toàn.
--
-- ⚠️  Hai câu CREATE TYPE dưới đây nếu Neon báo lỗi "already exists" thì
--     bỏ qua, chạy tiếp phần còn lại.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE session_half AS ENUM ('AM','PM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_kind AS ENUM ('OPENING','UNIT','INTERNAL','CLOSING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------------------
-- 1. Thông tin chương trình, bổ sung vào bảng audits
-- --------------------------------------------------------------------
ALTER TABLE audits ADD COLUMN IF NOT EXISTS objectives      text;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS criteria        text;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS location        text;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS approver_title  text;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS approver_name   text;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS am_start        text NOT NULL DEFAULT '08:00';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS am_end          text NOT NULL DEFAULT '11:30';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pm_start        text NOT NULL DEFAULT '13:30';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pm_end          text NOT NULL DEFAULT '17:00';

-- --------------------------------------------------------------------
-- 2. Đại diện đơn vị — in vào chương trình
-- --------------------------------------------------------------------
ALTER TABLE audit_units ADD COLUMN IF NOT EXISTS contact_person text;

-- --------------------------------------------------------------------
-- 3. Lịch đánh giá — mỗi dòng là MỘT BUỔI
--    Người tham gia không lưu ở đây, suy ra từ bảng assignments của đơn vị.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  day        text NOT NULL,                -- "YYYY-MM-DD"
  half       session_half NOT NULL,
  kind       session_kind NOT NULL DEFAULT 'UNIT',
  unit_id    uuid REFERENCES audit_units(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_sessions_audit_idx ON audit_sessions(audit_id);
CREATE INDEX IF NOT EXISTS audit_sessions_day_idx   ON audit_sessions(audit_id, day, half);

-- --------------------------------------------------------------------
-- 4. Kiểm tra
-- --------------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_name = 'audits' AND column_name IN
  ('objectives','criteria','location','approver_title','approver_name','am_start')
ORDER BY column_name;
