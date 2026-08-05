/**
 * Biểu tượng tệp Word và Excel.
 *
 * Vẽ lại chứ không dùng logo Microsoft: logo là nhãn hiệu đã đăng ký, nhúng vào
 * sản phẩm khác phải xin phép. Ở đây chỉ là hình trang giấy gấp góc kèm chữ cái,
 * tô đúng màu quy ước mà ai cũng nhận ra — xanh dương cho Word, xanh lá cho
 * Excel. Đủ để mắt bắt được loại tệp trước khi đọc chữ.
 */

const DOC_PATH = 'M6 2h6.5L18 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z';
const FOLD_PATH = 'M12.5 2 18 7.5h-4.5a1 1 0 0 1-1-1V2Z';

function FileIcon({ letter, className }: { letter: string; className?: string }) {
  return (
    <svg viewBox="0 0 22 24" className={className ?? 'h-4 w-4'} aria-hidden focusable="false">
      <path d={DOC_PATH} fill="currentColor" />
      <path d={FOLD_PATH} fill="#fff" fillOpacity={0.35} />
      <text
        x="11"
        y="17"
        textAnchor="middle"
        fill="#fff"
        fontSize="9"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}

/** Xanh dương Word. */
export function WordIcon({ className }: { className?: string }) {
  return (
    <span className="text-[#2B579A]">
      <FileIcon letter="W" className={className} />
    </span>
  );
}

/** Xanh lá Excel. */
export function ExcelIcon({ className }: { className?: string }) {
  return (
    <span className="text-[#217346]">
      <FileIcon letter="X" className={className} />
    </span>
  );
}
