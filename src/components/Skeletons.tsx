/**
 * Khung xương dùng cho các file `loading.tsx`.
 *
 * Next.js hiển thị chúng ngay khi người dùng bấm chuyển trang, trong lúc dữ liệu
 * còn đang lấy từ Neon. Không có chúng thì trang đứng im vài trăm mili giây tới
 * vài giây — trên mạng 3G ngoài hiện trường thì lâu hơn nhiều — và người dùng
 * tưởng bấm hụt nên bấm lại.
 *
 * Hình dạng khung xương bám sát bố cục thật để trang không "nhảy" khi dữ liệu về.
 */

export function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export function Block({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

/** Tiêu đề trang: một dòng nhỏ, một dòng lớn, một dòng phụ. */
export function PageHeadSkeleton() {
  return (
    <div className="space-y-2">
      <Bar className="h-3 w-24" />
      <Bar className="h-7 w-72 max-w-full" />
      <Bar className="h-3 w-56 max-w-full" />
    </div>
  );
}

/** Lưới thẻ — dùng cho danh sách đợt, danh sách đơn vị. */
export function CardListSkeleton({ count = 4, cols = 'md:grid-cols-2' }: { count?: number; cols?: string }) {
  return (
    <div className={`grid gap-4 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <Bar className="h-3 w-20" />
          <Bar className="h-5 w-3/4" />
          <Bar className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Bảng nhiều cột — dùng cho bảng tổng hợp finding. */
export function TableSkeleton({ rows = 6, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Bar key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-slate-100 px-4 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Trang chi tiết finding: cột nội dung rộng + cột phụ. */
export function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card space-y-3 p-5">
          <Bar className="h-3 w-32" />
          <Block className="h-32" />
        </div>
        <div className="card space-y-3 p-5">
          <Bar className="h-3 w-40" />
          <Block className="h-24" />
        </div>
      </div>
      <div className="space-y-6">
        <div className="card space-y-3 p-5">
          <Bar className="h-3 w-28" />
          <Block className="h-20" />
        </div>
        <div className="card space-y-3 p-5">
          <Bar className="h-3 w-24" />
          <Block className="h-16" />
        </div>
      </div>
    </div>
  );
}

/** Bốn ô đếm ở đầu trang tổng hợp. */
export function StatsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-2 p-4">
          <Bar className="h-3 w-24" />
          <Bar className="h-7 w-10" />
        </div>
      ))}
    </div>
  );
}
