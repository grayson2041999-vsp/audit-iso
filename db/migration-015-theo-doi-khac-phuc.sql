-- =====================================================================
-- Migration 015: theo dõi khắc phục do trưởng đoàn tự nhập
--
-- Thay cho luồng gửi báo cáo / đơn vị nộp hồ sơ khắc phục qua app (các bảng
-- report_releases, corrective_reports, corrective_items, corrective_events).
-- Đoàn và đơn vị trao đổi ở ngoài app; app chỉ là sổ theo dõi.
--
-- Mỗi dòng là một việc cần làm để khắc phục một finding. Đơn vị và phân loại
-- đọc qua finding. Các bảng cũ CHƯA xoá — xem phần cuối file.
--
-- Chỉ thêm bảng → chạy SQL này TRƯỚC, rồi mới push code.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE capa_action_status AS ENUM ('TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS capa_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id       uuid NOT NULL REFERENCES audits(id)   ON DELETE CASCADE,
  finding_id     uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  content        text NOT NULL,
  owner          text,
  due_date       date,
  status         capa_action_status NOT NULL DEFAULT 'TODO',
  completed_date date,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capa_actions_audit_idx   ON capa_actions(audit_id);
CREATE INDEX IF NOT EXISTS capa_actions_finding_idx ON capa_actions(finding_id);

-- Kiểm tra
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'capa_actions' ORDER BY ordinal_position;

-- ---------------------------------------------------------------------
-- (Về sau, khi chắc chắn không cần dữ liệu cũ, có thể xoá các bảng của
--  luồng gửi cho đơn vị — push code trước, rồi mới chạy:)
--
-- DROP TABLE IF EXISTS corrective_events, corrective_items, corrective_reports, report_releases;
-- DROP TYPE  IF EXISTS capa_status;
-- ---------------------------------------------------------------------
