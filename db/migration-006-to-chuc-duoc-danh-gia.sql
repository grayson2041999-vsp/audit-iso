-- =====================================================================
-- Migration 006: thay "Mã đợt" bằng "Tổ chức được đánh giá"
--
-- ⚠️  Có XOÁ cột → PHẢI push code mới TRƯỚC, đợi Vercel build xong,
--     rồi mới chạy file này.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Thêm cột mới (cho phép NULL trước, để còn điền dữ liệu cũ)
-- --------------------------------------------------------------------
ALTER TABLE audits ADD COLUMN IF NOT EXISTS organization text;

-- --------------------------------------------------------------------
-- 2. Đợt đã tạo trước đây chưa có tên tổ chức — tạm lấy mã đợt cũ làm
--    chỗ giữ chỗ để không vướng ràng buộc NOT NULL. Vào app sửa lại sau.
-- --------------------------------------------------------------------
UPDATE audits
SET organization = COALESCE(NULLIF(TRIM(organization), ''), NULLIF(TRIM(code), ''), 'Chưa khai báo')
WHERE organization IS NULL OR TRIM(organization) = '';

ALTER TABLE audits ALTER COLUMN organization SET NOT NULL;

-- --------------------------------------------------------------------
-- 3. Bỏ mã đợt
-- --------------------------------------------------------------------
ALTER TABLE audits DROP COLUMN IF EXISTS code;

-- --------------------------------------------------------------------
-- 4. Kiểm tra
-- --------------------------------------------------------------------
SELECT organization, title, status FROM audits ORDER BY created_at DESC;
