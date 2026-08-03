-- =====================================================================
-- Migration 005 (Đợt 3): gắn finding vào đợt / đơn vị / đánh giá viên
--
-- Chỉ THÊM cột và giá trị enum → chạy trước khi push là an toàn.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Trạng thái mới "SUBMITTED" (đã nộp)
--    Postgres không cho ALTER TYPE ... ADD VALUE bên trong transaction,
--    nên chạy câu này RIÊNG một mình trước các câu bên dưới.
-- --------------------------------------------------------------------
ALTER TYPE finding_status ADD VALUE IF NOT EXISTS 'SUBMITTED';

-- --------------------------------------------------------------------
-- 2. Cột mới trên findings
-- --------------------------------------------------------------------
ALTER TABLE findings ADD COLUMN IF NOT EXISTS unit_id      uuid REFERENCES audit_units(id)   ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS member_id    uuid REFERENCES audit_members(id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS findings_unit_idx   ON findings(unit_id);
CREATE INDEX IF NOT EXISTS findings_member_idx ON findings(member_id);

-- --------------------------------------------------------------------
-- 3. Mã finding duy nhất trong phạm vi một đợt.
--    Lưới an toàn cho bộ đếm audits.finding_seq.
-- --------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS findings_audit_code_idx ON findings(audit_id, code);

-- --------------------------------------------------------------------
-- 4. Xoá finding khi xoá đợt (trước đây chỉ gỡ liên kết, để lại rác)
-- --------------------------------------------------------------------
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_audit_id_audits_id_fk;
ALTER TABLE findings ADD  CONSTRAINT findings_audit_id_audits_id_fk
  FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE;

-- --------------------------------------------------------------------
-- 5. Kiểm tra
-- --------------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_name = 'findings' AND column_name IN ('unit_id','member_id','submitted_at')
ORDER BY column_name;
