-- =====================================================================
-- Migration 014: ngày thực hiện là DANH SÁCH NGÀY CỤ THỂ, không còn là
-- một khoảng liền mạch "từ ngày → đến ngày".
--
-- Thực tế họp khai mạc một ngày, các ngày đánh giá rời rạc, họp kết thúc
-- một ngày khác. Mỗi phần tử mang luôn khung giờ của ngày đó:
--   [{"date":"2026-10-22","amStart":"08:00","amEnd":"11:30",
--     "pmStart":"13:30","pmEnd":"17:00","meetingOnly":true}, ...]
--
-- start_date / end_date vẫn giữ, app tự ghi bằng ngày đầu và ngày cuối để
-- danh sách đợt, báo cáo, Excel không phải đổi gì.
--
-- day_hours (khung giờ theo thứ tự ngày) không dùng nữa nhưng CHƯA xoá —
-- để code cũ chạy được trong lúc Vercel build.
--
-- (Số 013 dành cho phần đăng nhập Microsoft đang hoãn.)
--
-- Chỉ thêm cột → chạy SQL này TRƯỚC, rồi mới push code.
-- =====================================================================

-- 1. Thêm cột
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS audit_days jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Chuyển các đợt đang có: mỗi ngày trong khoảng cũ thành một phần tử,
--    khung giờ lấy từ day_hours theo thứ tự, thiếu thì lấy giờ mặc định của đợt.
UPDATE audits a
SET audit_days = (
  SELECT jsonb_agg(
           jsonb_build_object(
             'date',    to_char(g.d, 'YYYY-MM-DD'),
             'amStart', COALESCE(a.day_hours -> (g.i::int - 1) ->> 'amStart', a.am_start),
             'amEnd',   COALESCE(a.day_hours -> (g.i::int - 1) ->> 'amEnd',   a.am_end),
             'pmStart', COALESCE(a.day_hours -> (g.i::int - 1) ->> 'pmStart', a.pm_start),
             'pmEnd',   COALESCE(a.day_hours -> (g.i::int - 1) ->> 'pmEnd',   a.pm_end)
           )
           ORDER BY g.d
         )
  FROM generate_series(
         (a.start_date AT TIME ZONE 'UTC')::date,
         (a.end_date   AT TIME ZONE 'UTC')::date,
         interval '1 day'
       ) WITH ORDINALITY AS g(d, i)
)
WHERE a.audit_days = '[]'::jsonb
  AND a.start_date IS NOT NULL
  AND a.end_date IS NOT NULL
  AND a.end_date >= a.start_date;

-- 3. Kiểm tra: mỗi đợt có bao nhiêu ngày
SELECT title,
       to_char(start_date AT TIME ZONE 'UTC', 'DD/MM/YYYY') AS tu_ngay,
       to_char(end_date   AT TIME ZONE 'UTC', 'DD/MM/YYYY') AS den_ngay,
       jsonb_array_length(audit_days) AS so_ngay
FROM audits
ORDER BY start_date DESC NULLS LAST;
