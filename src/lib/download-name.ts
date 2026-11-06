/**
 * Tên file tải về: "<Tiền tố> - <Tên đợt đánh giá>.<đuôi>", giữ nguyên dấu
 * tiếng Việt, ví dụ "Chương trình đánh giá - Đánh giá nội bộ năm 2026.docx".
 *
 * Trả về giá trị cho header Content-Disposition. Gửi hai bản tên:
 *  - `filename*` (UTF-8): bản có dấu — trình duyệt hiện nay đều dùng bản này,
 *  - `filename`: bản bỏ dấu, cho trình duyệt cũ không đọc được `filename*`.
 * Ký tự Windows / macOS không cho đặt trong tên file được thay bằng khoảng trắng.
 */
export function attachmentHeader(prefix: string, auditTitle: string, ext: 'docx' | 'xlsx'): string {
  const title = auditTitle
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const fileName = `${prefix} - ${title || 'Đợt đánh giá'}.${ext}`;

  const ascii = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '');

  // encodeURIComponent để lọt ' ( ) — ba ký tự này không được đứng trần trong filename*.
  const encoded = encodeURIComponent(fileName).replace(
    /['()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
