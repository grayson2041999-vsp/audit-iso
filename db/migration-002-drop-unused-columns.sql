-- =====================================================================
-- Migration 002: xoá các cột AI không còn sinh ra (tối ưu "Gói B")
--
-- ⚠️  THAO TÁC KHÔNG THỂ HOÀN TÁC. Dữ liệu trong 5 cột này sẽ mất vĩnh viễn.
--     Nếu đã có finding thật cần giữ, chạy bước SAO LƯU bên dưới trước.
--
-- ⚠️  PHẢI push code mới (đã bỏ 5 cột khỏi src/lib/schema.ts) TRƯỚC hoặc
--     CÙNG LÚC. Nếu xoá cột trong khi bản deploy cũ còn chạy, mọi truy vấn
--     findings sẽ lỗi "column does not exist".
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bước 0 (tuỳ chọn) — sao lưu trước khi xoá
-- Giữ lại bản chụp dữ liệu cũ sang một bảng riêng, phòng khi cần tra cứu.
-- ---------------------------------------------------------------------
-- CREATE TABLE findings_legacy_fields AS
-- SELECT id, requirement, nonconformity, risk_analysis, suggested_action, confidence
-- FROM findings
-- WHERE requirement IS NOT NULL
--    OR nonconformity IS NOT NULL
--    OR risk_analysis IS NOT NULL
--    OR suggested_action IS NOT NULL
--    OR confidence IS NOT NULL;

-- ---------------------------------------------------------------------
-- Bước 1 — xoá cột
-- ---------------------------------------------------------------------
ALTER TABLE findings DROP COLUMN IF EXISTS requirement;
ALTER TABLE findings DROP COLUMN IF EXISTS nonconformity;
ALTER TABLE findings DROP COLUMN IF EXISTS risk_analysis;
ALTER TABLE findings DROP COLUMN IF EXISTS suggested_action;
ALTER TABLE findings DROP COLUMN IF EXISTS confidence;

-- ---------------------------------------------------------------------
-- Bước 2 — kiểm tra kết quả (phải KHÔNG còn dòng nào)
-- ---------------------------------------------------------------------
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'findings'
  AND column_name IN ('requirement','nonconformity','risk_analysis','suggested_action','confidence');
