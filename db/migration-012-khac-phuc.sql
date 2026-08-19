-- =====================================================================
-- 012 — Phát hành báo cáo cho đơn vị & theo dõi hành động khắc phục
--
-- Chỉ THÊM bảng và cột, không xoá gì, nên chạy được TRƯỚC khi push code
-- mà bản deploy đang chạy không bị ảnh hưởng.
--
--   psql "$DATABASE_URL" -f db/migration-012-khac-phuc.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

/* ------------------------------------------------------------------ */
/* Trạng thái gói khắc phục                                            */
/* ------------------------------------------------------------------ */

/**
 * Hai mốc duyệt, không phải một:
 *   PLAN_*     — đơn vị trình KẾ HOẠCH khắc phục, trưởng đoàn duyệt cách làm
 *   EVIDENCE_* — đơn vị nộp BẰNG CHỨNG đã làm xong, trưởng đoàn xác nhận hiệu lực
 *
 * ISO 9001 §10.2.1 e) yêu cầu "xem xét hiệu lực của mọi hành động khắc phục đã
 * thực hiện" — duyệt kế hoạch không phải xem xét hiệu lực. Gộp hai mốc làm một
 * là chỗ đa số hệ thống CAPA làm sai.
 */
DO $$ BEGIN
  CREATE TYPE capa_status AS ENUM (
    'PLAN_DRAFT',
    'PLAN_SUBMITTED',
    'PLAN_REJECTED',
    'PLAN_APPROVED',
    'EVIDENCE_SUBMITTED',
    'EVIDENCE_REJECTED',
    'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ------------------------------------------------------------------ */
/* audits — dấu vết phát hành                                          */
/* ------------------------------------------------------------------ */

-- Đã gửi báo cáo cho đơn vị chưa. NULL = chưa. Trạng thái "đã phát hành" suy
-- ra từ cột này chứ không thêm giá trị enum mới — cùng cách nghĩ với phần còn
-- lại của app: trạng thái là hệ quả của hành động, không phải nút bật/tắt.
ALTER TABLE audits ADD COLUMN IF NOT EXISTS issued_at timestamptz;

-- Số bản đã phát hành. 0 = chưa phát hành lần nào.
ALTER TABLE audits ADD COLUMN IF NOT EXISTS report_version integer NOT NULL DEFAULT 0;

/* ------------------------------------------------------------------ */
/* audit_units — mã 8 số cho đơn vị được đánh giá                      */
/* ------------------------------------------------------------------ */

-- Lưu dạng đọc được, giống mã 6 số của đánh giá viên: trưởng đoàn phải tra lại
-- được cho đơn vị quên mã. Đánh đổi đã biết và chấp nhận.
ALTER TABLE audit_units ADD COLUMN IF NOT EXISTS access_code text;

/* ------------------------------------------------------------------ */
/* report_releases — mỗi lần phát hành một dòng                        */
/* ------------------------------------------------------------------ */

/**
 * ĐƠN VỊ ĐỌC ẢNH CHỤP, KHÔNG ĐỌC DỮ LIỆU SỐNG.
 *
 * Đây là điểm mấu chốt của thiết kế. Trưởng đoàn có mở đợt ra sửa gì thì bên
 * đơn vị vẫn thấy đúng bản đã gửi, cho tới khi bấm phát hành bản mới. Nhờ vậy
 * vừa không khoá chết báo cáo (còn sửa được lỗi chính tả, rút finding sai),
 * vừa không ai sửa lén được thứ đã gửi đi.
 *
 * `reason` bắt buộc từ bản 2 trở đi — ràng buộc kiểm ở tầng ứng dụng vì bản 1
 * không cần lý do.
 */
CREATE TABLE IF NOT EXISTS report_releases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id     uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  reason       text,
  released_by  text,
  snapshot     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS report_releases_version_idx
  ON report_releases (audit_id, version);

/* ------------------------------------------------------------------ */
/* corrective_reports — MỘT gói khắc phục cho MỘT đơn vị               */
/* ------------------------------------------------------------------ */

/**
 * Đơn vị nộp cả gói một lần, không nộp lẻ từng finding.
 *
 * Đổi lại, trưởng đoàn vẫn phản hồi được CHI TIẾT TỚI TỪNG FINDING qua cột
 * `verdict` ở bảng `corrective_items` — trả lại cả gói nhưng đơn vị biết chính
 * xác mục nào chưa đạt, không phải làm lại từ đầu.
 */
CREATE TABLE IF NOT EXISTS corrective_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id              uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  unit_id               uuid NOT NULL REFERENCES audit_units(id) ON DELETE CASCADE,
  status                capa_status NOT NULL DEFAULT 'PLAN_DRAFT',

  -- Lãnh đạo phòng chịu trách nhiệm. Mã dùng chung cả đơn vị nên đây là chỗ
  -- duy nhất ghi được ai đứng tên; ISO 9001 §10.2.2 yêu cầu lưu hồ sơ này.
  responsible_name      text,
  responsible_title     text,

  -- Lần nộp thứ mấy. Tăng mỗi khi trưởng đoàn trả lại.
  round                 integer NOT NULL DEFAULT 1,

  plan_submitted_at     timestamptz,
  plan_reviewed_at      timestamptz,
  evidence_submitted_at timestamptz,
  closed_at             timestamptz,

  -- Ghi chú lần duyệt gần nhất (lý do trả lại, hoặc nhận xét khi duyệt).
  review_note           text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS corrective_reports_pair_idx
  ON corrective_reports (audit_id, unit_id);

/* ------------------------------------------------------------------ */
/* corrective_items — mỗi sự không phù hợp một dòng                    */
/* ------------------------------------------------------------------ */

/**
 * Chỉ tạo cho finding mức MAJOR và MINOR. OBS / OFI / CONF không bắt buộc khắc
 * phục — bắt đơn vị làm hồ sơ CAPA cho một cơ hội cải tiến là cách nhanh nhất
 * khiến họ ghét cả công cụ lẫn việc đánh giá.
 *
 * `is_active`: phát hành bản mới có thể làm một finding thôi là NC (bị hạ mức
 * hoặc rút). Không xoá dòng — đơn vị đã gõ nội dung vào đó — mà tắt đi, để
 * lịch sử còn nguyên và bật lại được nếu bản sau đảo ngược quyết định.
 */
CREATE TABLE IF NOT EXISTS corrective_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        uuid NOT NULL REFERENCES corrective_reports(id) ON DELETE CASCADE,
  finding_id       uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  is_active        boolean NOT NULL DEFAULT true,

  -- Mốc 1 — kế hoạch
  immediate_action text,
  root_cause       text,
  action_plan      text,
  target_date      timestamptz,

  -- Mốc 2 — bằng chứng đã thực hiện
  completion_note  text,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Trưởng đoàn chấm từng mục: NULL chưa chấm · 'OK' đạt · 'NG' chưa đạt
  verdict          text,
  leader_note      text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS corrective_items_pair_idx
  ON corrective_items (report_id, finding_id);

/* ------------------------------------------------------------------ */
/* corrective_events — nhật ký nộp / duyệt / trả lại                   */
/* ------------------------------------------------------------------ */

/**
 * Mỗi lần nộp hoặc duyệt ghi một dòng kèm ảnh chụp toàn bộ gói. Bản bị trả lại
 * KHÔNG bị ghi đè — đọc lại được vì sao đơn vị phải làm tới lần thứ ba.
 */
CREATE TABLE IF NOT EXISTS corrective_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid NOT NULL REFERENCES corrective_reports(id) ON DELETE CASCADE,
  round      integer NOT NULL,
  phase      text NOT NULL,   -- 'plan' | 'evidence'
  action     text NOT NULL,   -- 'submit' | 'approve' | 'reject'
  actor      text,
  note       text,
  snapshot   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corrective_events_report_idx
  ON corrective_events (report_id, created_at DESC);

/* ------------------------------------------------------------------ */
/* audit_events — nhật ký hành động cấp đợt                            */
/* ------------------------------------------------------------------ */

/**
 * Chỗ ghi những việc phải truy được về sau: khoá đợt, mở lại sau khi đã phát
 * hành, phát hành bản mới. Mở khoá một đợt ĐÃ GỬI cho đơn vị là hành động
 * nhạy cảm nhất trong app — bắt buộc có lý do và phải để lại dấu.
 */
CREATE TABLE IF NOT EXISTS audit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  actor      text,
  action     text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_audit_idx
  ON audit_events (audit_id, created_at DESC);
