/**
 * Logo app — phương án B: chữ "I" của "ISO" là tháp khoan trong biểu trưng
 * Vietsovpetro, bên dưới là hai dải sóng đỏ – xanh lấy từ lá cờ của biểu trưng.
 *
 * Vẽ bằng SVG nội tuyến chứ không dùng ảnh: nét luôn sắc ở mọi cỡ màn hình,
 * và chữ "SO" dùng đúng font của trang (SF Pro / Inter) nên khớp với phần còn lại.
 * Tháp khoan và chữ ăn theo `currentColor` — đổi màu bằng class `text-*`.
 *
 * Biểu tượng tab trình duyệt và màn hình chính nằm ở `src/app/icon.svg`,
 * `src/app/favicon.ico`, `src/app/apple-icon.png` và `public/icons/`.
 */
const VSP_RED = '#ed3237';
const VSP_BLUE = '#0f62ac';

const DERRICK =
  'M15 10 L2 100 M25 10 L38 100 M12.11 30 L31.07 52 M27.89 30 L8.93 52 M8.93 52 L31.07 52 ' +
  'M8.93 52 L34.53 76 M31.07 52 L5.47 76 M5.47 76 L34.53 76 M5.47 76 L38 100 M34.53 76 L2 100 M2 100 L38 100';

export function LogoWordmark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 172 114" role="img" aria-label="ISO" className={className}>
      <g transform="translate(2 14) scale(0.72)">
        <rect x="14" y="0" width="12" height="4.5" fill="currentColor" />
        <rect x="10.5" y="6.5" width="19" height="3.5" fill="currentColor" />
        <rect x="4" y="28.5" width="32" height="3.5" fill="currentColor" />
        <path d={DERRICK} stroke="currentColor" strokeWidth="6" strokeLinecap="square" fill="none" />
      </g>
      <text
        x="36"
        y="86"
        fontSize="99"
        fontWeight="600"
        letterSpacing="-2"
        fill="currentColor"
        style={{ fontFamily: 'inherit' }}
      >
        SO
      </text>
      <path d="M0 98 C 30 90, 60 90, 90 98 S 150 106, 170 96" stroke={VSP_RED} strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M0 108 C 30 100, 60 100, 90 108 S 150 116, 170 106" stroke={VSP_BLUE} strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
