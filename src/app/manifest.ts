import type { MetadataRoute } from 'next';

/**
 * Thông tin để Android/Chrome "Thêm vào màn hình chính" hiện đúng tên và biểu tượng.
 * (iPhone dùng `apple-icon.png` và `appleWebApp.title` trong layout.tsx.)
 *
 * `display: 'browser'` — bấm biểu tượng sẽ mở app trong trình duyệt như bình thường,
 * giữ nút Quay lại và thanh địa chỉ. Đổi sang 'standalone' nếu muốn mở toàn màn
 * hình như một ứng dụng riêng.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Đánh giá nội bộ ISO',
    short_name: 'Đánh giá ISO',
    description: 'Quản lý đợt đánh giá nội bộ và chuẩn hoá phát hiện theo ISO 9001 / 14001 / 45001',
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
