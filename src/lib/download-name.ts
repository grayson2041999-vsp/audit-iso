/** Bỏ ký tự Windows / macOS không cho đặt trong tên file, gom khoảng trắng. */
function cleanName(name: string) {
  return name
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Tên file tải về: "<Tiền tố> - <Tên đợt đánh giá>.<đuôi>", giữ nguyên dấu
 * tiếng Việt, ví dụ "Chương trình đánh giá - Đánh giá nội bộ năm 2026.docx".
 */
export function attachmentHeader(prefix: string, auditTitle: string, ext: 'docx' | 'xlsx'): string {
  return attachmentHeaderNamed(`${prefix} - ${cleanName(auditTitle) || 'Đợt đánh giá'}`, ext);
}

/**
 * Giá trị header Content-Disposition cho một tên file bất kỳ (chưa có đuôi).
 * Gửi hai bản tên:
 *  - `filename*` (UTF-8): bản có dấu — trình duyệt hiện nay đều dùng bản này,
 *  - `filename`: bản bỏ dấu, cho trình duyệt cũ không đọc được `filename*`.
 * Trang tự tải bằng JavaScript thì đọc lại bằng `fileNameFromHeader`.
 */
export function attachmentHeaderNamed(baseName: string, ext: 'docx' | 'xlsx'): string {
  const fileName = `${cleanName(baseName) || 'Tai lieu'}.${ext}`;

  const ascii = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/ {2,}/g, ' ');

  // encodeURIComponent để lọt ' ( ) — ba ký tự này không được đứng trần trong filename*.
  const encoded = encodeURIComponent(fileName).replace(
    /['()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Lấy lại tên file từ header Content-Disposition, ưu tiên bản có dấu. */
export function fileNameFromHeader(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      /* mã hoá hỏng — dùng bản bỏ dấu bên dưới */
    }
  }
  return header.match(/filename="(.+?)"/)?.[1] ?? null;
}
