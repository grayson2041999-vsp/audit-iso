/**
 * Đọc một chuỗi JSON còn dở dang.
 *
 * Khi stream tool use, model gửi về từng mẩu chuỗi JSON. Ghép lại giữa chừng thì
 * gần như luôn được một chuỗi hỏng:
 *
 *     {"severityRationale":"Ghi nhận mô tả 3/10 bình chữa
 *
 * Hàm này VÁ tạm chỗ còn thiếu — đóng dấu nháy đang mở, đóng nốt các ngoặc còn
 * treo — rồi mới parse. Nhờ vậy giao diện đọc được những trường đã hoàn tất và
 * cả trường đang viết dở, thay vì phải chờ mẩu cuối cùng mới hiện được gì.
 *
 * Đây chỉ dùng để HIỂN THỊ TẠM. Bản chính thức vẫn là bản máy chủ gửi ở cuối,
 * đã qua Zod và đã hậu kiểm điều khoản.
 */
export function parsePartialJson<T = unknown>(raw: string): Partial<T> | null {
  const text = raw.trimEnd();
  if (!text) return null;

  // Thử nguyên bản trước — mẩu cuối cùng thì chuỗi đã hoàn chỉnh.
  try {
    return JSON.parse(text) as Partial<T>;
  } catch {
    /* còn dở, đi vá */
  }

  /** Ngăn xếp ngoặc đang mở, và có đang ở giữa một chuỗi hay không. */
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  let patched = text;

  // Ký tự cuối là dấu gạch chéo thoát dở thì bỏ đi, không thì đóng chuỗi xong vẫn hỏng.
  if (escaped) patched = patched.slice(0, -1);
  if (inString) patched += '"';

  // Bỏ phần đuôi cụt: dấu phẩy treo, hoặc khoá đã có mà chưa có giá trị.
  patched = patched.replace(/,\s*$/, '').replace(/:\s*$/, ': null').replace(/,\s*("[^"]*")\s*$/, '');

  for (let i = stack.length - 1; i >= 0; i--) {
    patched += stack[i] === '{' ? '}' : ']';
  }

  try {
    return JSON.parse(patched) as Partial<T>;
  } catch {
    return null;
  }
}
