import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#d9e6ff', 200: '#bcd2ff', 300: '#8eb4ff',
          400: '#598cff', 500: '#3366ff', 600: '#1f45f5', 700: '#1a34e1',
          800: '#1c2eb6', 900: '#1d2e8f',
        },
      },
      fontFamily: {
        // Biến --font-sans / --font-mono do next/font gán ở thẻ <html> (xem layout.tsx).
        // Luôn kèm font dự phòng: nếu biến chưa có, cả dòng khai báo sẽ hỏng và
        // trình duyệt rơi về mặc định của nó là serif — đúng lỗi đã gặp trước đây.
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
