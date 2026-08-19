/**
 * Nén ảnh ngay trên máy auditor, TRƯỚC khi xin giấy phép upload.
 *
 * Vì sao cần: một tấm ảnh điện thoại 3–5 MB đẩy qua 4G ở nhà xưởng mất 10–20
 * giây. Sáu tấm là hai phút đứng chờ giữa lúc đang đánh giá. Đưa cạnh dài về
 * 2048px và mã hoá lại JPEG cho ra file 250–400 KB — nhanh hơn khoảng mười lần,
 * và Claude vision đọc ảnh 2048px không kém gì ảnh 4000px.
 *
 * ⚠️ ĐÁNH ĐỔI PHẢI BIẾT: mã hoá lại ảnh sẽ XOÁ TOÀN BỘ METADATA EXIF — thời
 * điểm chụp và toạ độ GPS. Với hồ sơ đánh giá, hai thứ đó làm tăng độ tin cậy
 * của bằng chứng. Nếu tổ chức của bạn cần giữ, đặt `COMPRESS_ENABLED = false`
 * và chấp nhận upload chậm; hoặc đọc EXIF ra rồi lưu vào database trước khi nén
 * (chưa làm, cần thêm cột trong `finding_images`).
 *
 * ⚠️ THỨ TỰ BẮT BUỘC: nén xong rồi mới gọi `/api/uploads/presign`. Giấy phép
 * giờ ký kèm số byte chính xác, nên đổi file sau khi ký là R2 trả 403.
 */

/** Đặt `false` để tắt hẳn việc nén, giữ nguyên ảnh gốc kèm EXIF. */
export const COMPRESS_ENABLED = true;

/**
 * Cạnh dài tối đa sau khi nén.
 *
 * Chọn 2048 chứ không phải 1600: bằng chứng đánh giá thường là ảnh chụp tài
 * liệu, tem kiểm định, nhãn thiết bị — chữ nhỏ trên đó phải còn đọc được. 2048
 * vẫn nhỏ hơn ảnh gốc cỡ 4–8 lần nhưng giữ được chữ.
 */
export const COMPRESS_MAX_EDGE = 2048;

export const COMPRESS_QUALITY = 0.85;

/** Dưới ngưỡng này thì để nguyên — nén cũng chẳng tiết kiệm được bao nhiêu. */
export const COMPRESS_SKIP_UNDER_BYTES = 800 * 1024;

/**
 * Trả về file đã nén, hoặc chính file gốc nếu không nén được / không đáng nén.
 *
 * KHÔNG BAO GIỜ NÉM LỖI. Nén chỉ là tối ưu; trình duyệt cũ không hỗ trợ, ảnh
 * hỏng, hết bộ nhớ — mọi trường hợp đều lặng lẽ trả lại file gốc và để luồng
 * upload chạy tiếp. Chặn auditor lại vì bước tối ưu thất bại là đánh đổi sai.
 */
export async function compressImage(file: File): Promise<File> {
  if (!COMPRESS_ENABLED) return file;
  if (file.size <= COMPRESS_SKIP_UNDER_BYTES) return file;

  // Ảnh động: vẽ lên canvas chỉ lấy được khung hình đầu, nén là hỏng nội dung.
  if (file.type === 'image/gif') return file;

  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap | null = null;
  try {
    /**
     * `imageOrientation: 'from-image'` là bắt buộc. Ảnh điện thoại thường được
     * chụp ngang rồi đánh dấu "xoay 90°" trong EXIF; bỏ tuỳ chọn này thì canvas
     * vẽ theo pixel thô và ảnh ra nằm nghiêng.
     */
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    const scale = Math.min(1, COMPRESS_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    /**
     * Nền trắng trước khi vẽ. JPEG không có kênh trong suốt, nên vùng trong
     * suốt của PNG sẽ thành ĐEN nếu không lót nền — ảnh chụp màn hình tài liệu
     * hay dính lỗi này.
     */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', COMPRESS_QUALITY),
    );
    if (!blob) return file;

    // Nén xong mà to hơn bản gốc (ảnh vốn đã tối ưu) thì dùng bản gốc.
    if (blob.size >= file.size) return file;

    return new File([blob], toJpgName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/** "IMG_0421.HEIC" → "IMG_0421.jpg". Đuôi phải khớp nội dung thật sau khi nén. */
function toJpgName(name: string) {
  return name.replace(/\.[^./\\]+$/, '') + '.jpg';
}
