-- Khung giờ làm việc riêng cho từng ngày đánh giá.
--
-- Mảng theo THỨ TỰ NGÀY trong đợt, không phải theo ngày dương lịch:
--   [{"amStart":"08:00","amEnd":"11:30","pmStart":"13:30","pmEnd":"17:00"}, ...]
-- Phần tử 0 là ngày 1, phần tử 1 là ngày 2...
--
-- Đánh chỉ số theo thứ tự vì lịch cũng vậy: dời cả đợt sang tuần khác thì ngày 1
-- vẫn là ngày 1, khung giờ đi theo mà không phải ánh xạ lại ngày tháng.
--
-- Mảng rỗng, hoặc ngắn hơn số ngày của đợt, thì những ngày còn thiếu dùng bốn
-- cột am_start / am_end / pm_start / pm_end sẵn có. Nhờ vậy mọi đợt đang chạy
-- không cần chuyển đổi dữ liệu.
--
-- Chạy SQL này TRƯỚC khi đẩy code (chỉ thêm cột, code cũ không đụng tới).

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS day_hours jsonb NOT NULL DEFAULT '[]'::jsonb;
