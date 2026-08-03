-- =====================================================================
-- Migration 003 (Đợt 1): tài khoản trưởng đoàn + đợt đánh giá
--
-- Chạy TRƯỚC khi push code đợt 1 (migration này chỉ THÊM, không xoá gì
-- mà code cũ đang dùng, nên chạy trước là an toàn).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------
-- 1. Tài khoản trưởng đoàn
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------
-- 2. Bổ sung cột cho bảng audits
-- --------------------------------------------------------------------
ALTER TABLE audits ADD COLUMN IF NOT EXISTS leader_id   uuid REFERENCES leaders(id) ON DELETE CASCADE;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS finding_seq integer NOT NULL DEFAULT 0;

-- Đơn vị được đánh giá giờ là bảng riêng (audit_units, làm ở đợt 2)
ALTER TABLE audits DROP COLUMN IF EXISTS auditee;

-- Đợt mới tạo phải ở trạng thái "Đang chuẩn bị"
ALTER TABLE audits ALTER COLUMN status SET DEFAULT 'PLANNED';

-- --------------------------------------------------------------------
-- 3. leader_id phải NOT NULL. Bảng audits hiện chưa có dòng nào nên
--    ràng buộc này áp được ngay. Nếu vì lý do nào đó đã có dữ liệu,
--    câu lệnh sẽ báo lỗi — khi đó xoá dòng cũ rồi chạy lại.
-- --------------------------------------------------------------------
ALTER TABLE audits ALTER COLUMN leader_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS audits_leader_idx ON audits(leader_id);

-- --------------------------------------------------------------------
-- 4. Kiểm tra
-- --------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audits'
ORDER BY ordinal_position;
