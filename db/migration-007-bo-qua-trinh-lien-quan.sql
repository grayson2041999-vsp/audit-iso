-- =====================================================================
-- Migration 007: bỏ cột "Quá trình liên quan"
--
-- Ô này đã được gỡ khỏi form ghi nhận. Nó không xuất hiện ở bảng tổng hợp
-- cũng không có trong file Excel, và nội dung của nó thường đã nằm sẵn
-- trong phần ghi nhận thô.
--
-- ⚠️  Có XOÁ cột → PHẢI push code mới TRƯỚC, đợi Vercel build xong,
--     rồi mới chạy file này.
-- =====================================================================

ALTER TABLE findings DROP COLUMN IF EXISTS raw_process;

-- Kiểm tra: phải trả về 0 dòng
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'findings' AND column_name = 'raw_process';
