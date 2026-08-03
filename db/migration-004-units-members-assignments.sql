-- =====================================================================
-- Migration 004 (Đợt 2): đơn vị được đánh giá, đánh giá viên, phân công
--
-- Chỉ THÊM bảng mới, không đụng gì bảng cũ → chạy trước khi push là an toàn.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------
-- Đơn vị được đánh giá — khai báo riêng theo từng đợt
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  name       text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_units_audit_idx ON audit_units(audit_id);

-- --------------------------------------------------------------------
-- Đánh giá viên của đợt
--   access_code : mã 6 số, NULL cho tới khi trưởng đoàn bấm "Sinh mã & mở đợt"
--   home_unit   : đơn vị công tác, dùng để cảnh báo tự đánh giá chính mình
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id    uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  home_unit   text,
  access_code text,
  is_leader   text NOT NULL DEFAULT '0',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_members_audit_idx ON audit_members(audit_id);

-- --------------------------------------------------------------------
-- Phân công nhiều–nhiều
-- Ràng buộc duy nhất trên cặp (member, unit) chặn phân công trùng
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES audit_members(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL REFERENCES audit_units(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_audit_idx ON assignments(audit_id);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_pair_idx ON assignments(member_id, unit_id);

-- --------------------------------------------------------------------
-- Kiểm tra
-- --------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('audit_units','audit_members','assignments')
ORDER BY table_name;
