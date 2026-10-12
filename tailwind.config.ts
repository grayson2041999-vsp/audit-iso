import type { Config } from 'tailwindcss';

/**
 * Hệ thiết kế theo DESIGN.md (phong cách "white gallery" của Apple):
 * nền trắng / Studio Mist, chữ Ink, một màu xanh duy nhất cho liên kết và nút chính,
 * bo góc lớn, gần như không đổ bóng.
 *
 * Bảng `slate` và `brand` được ghi đè ngay tại đây để toàn bộ class sẵn có
 * (text-slate-500, bg-brand-600…) tự chuyển sang màu mới mà không phải sửa từng file.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Thang trung tính của Apple — slate-50 = Studio Mist, slate-900 = Ink.
        slate: {
          50: '#f5f5f7',  // Studio Mist
          100: '#ededf0',
          200: '#e6e6e8', // Control Gray
          300: '#d6d6d6', // Hairline Silver
          400: '#86868b', // Steel
          500: '#707070', // Slate
          600: '#515154',
          700: '#3a3a3c',
          800: '#2c2c2e',
          900: '#1d1d1f', // Ink
          950: '#000000',
        },
        // Thang xanh xoay quanh Pricing Blue (#0071e3) và Apple Blue (#0066cc).
        brand: {
          50: '#f0f6fe', 100: '#ddebfc', 200: '#bcd7f8', 300: '#8ebcf2',
          400: '#4a96ea', 500: '#0077ed', 600: '#0071e3', 700: '#0066cc',
          800: '#00519f', 900: '#003f7d',
        },
        ink: '#1d1d1f',
        mist: '#f5f5f7',
        frost: '#fafafc',
        hairline: '#d6d6d6',
        control: '#e6e6e8',
        steel: '#86868b',
        launch: '#b64400',
      },
      fontFamily: {
        // SF Pro trên thiết bị Apple; Inter (tải qua next/font, có bộ dấu tiếng Việt)
        // ở Windows/Android. Luôn kèm font dự phòng để không bao giờ rơi về serif.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'var(--font-sans)',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        display: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'var(--font-sans)',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // Thang chữ của DESIGN.md: chữ nhỏ tracking âm, tiêu đề lớn siết lại.
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '-0.08px' }],
        xs: ['12px', { lineHeight: '16px', letterSpacing: '-0.12px' }],
        sm: ['14px', { lineHeight: '20px', letterSpacing: '-0.224px' }],
        base: ['17px', { lineHeight: '25px', letterSpacing: '-0.374px' }],
        lg: ['19px', { lineHeight: '23px', letterSpacing: '0.012em' }],
        xl: ['21px', { lineHeight: '25px', letterSpacing: '0.011em' }],
        '2xl': ['28px', { lineHeight: '32px', letterSpacing: '0.007em' }],
        '3xl': ['40px', { lineHeight: '44px', letterSpacing: '0' }],
        '4xl': ['48px', { lineHeight: '52px', letterSpacing: '-0.003em' }],
        '5xl': ['56px', { lineHeight: '60px', letterSpacing: '-0.005em' }],
        '6xl': ['80px', { lineHeight: '84px', letterSpacing: '-1.2px' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '28px',
        card: '28px',
        nav: '20px',
      },
      boxShadow: {
        // Không đổ bóng — chỉ viền 1px như DESIGN.md.
        subtle: 'rgb(230, 230, 232) 0px 0px 0px 1px',
        'subtle-2': 'rgb(134, 134, 139) 0px 0px 0px 1px',
        sm: 'rgb(230, 230, 232) 0px 0px 0px 1px',
        DEFAULT: 'rgb(214, 214, 214) 0px 0px 0px 1px',
        lg: 'rgb(214, 214, 214) 0px 0px 0px 1px',
      },
    },
  },
  plugins: [],
};
export default config;
