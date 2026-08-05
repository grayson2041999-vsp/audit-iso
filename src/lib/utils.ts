import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/**
 * Viết tắt tên người Việt: "Lê Hữu Hoàng Sơn" → "L.H.H. Sơn".
 * Giữ nguyên tên cuối vì đó là phần người Việt dùng để gọi nhau.
 */
export function abbreviateName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return full.trim();
  const last = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((p) => p[0].toLocaleUpperCase('vi') + '.')
    .join('');
  return `${initials} ${last}`;
}

/**
 * Viết tắt cả danh sách, nhưng GIỮ NGUYÊN tên đầy đủ cho những người bị trùng
 * dạng viết tắt — "Lê Hữu Hoàng Sơn" và "Lý Hồng Hải Sơn" đều ra "L.H.H. Sơn",
 * viết tắt lúc đó gây nhầm còn tệ hơn tên dài.
 */
export function buildShortNames(names: string[]): string[] {
  const abbrs = names.map(abbreviateName);
  const count = new Map<string, number>();
  for (const a of abbrs) count.set(a, (count.get(a) ?? 0) + 1);
  return abbrs.map((a, i) => (count.get(a)! > 1 ? names[i] : a));
}

/**
 * So tên đơn vị bỏ qua hoa thường và khoảng trắng thừa.
 * Đặt ở utils vì cả máy chủ lẫn component trình duyệt đều dùng.
 */
export function sameUnitName(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return norm(a) === norm(b);
}

/** Chỉ ngày/tháng/năm, dùng cho thời hạn khắc phục. */
export function formatDateOnly(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
}

/**
 * Số ngày còn lại tới hạn khắc phục (âm là đã quá hạn) và mức cảnh báo.
 * So sánh theo ngày lịch, không tính giờ, để "đến hạn hôm nay" là đúng nghĩa.
 */
export function dueStatus(due: Date | string) {
  const d = typeof due === 'string' ? new Date(due) : due;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  const tone: 'overdue' | 'soon' | 'ok' = days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'ok';
  return { days, tone };
}

export const SEVERITY_STYLE: Record<string, string> = {
  MAJOR: 'bg-red-100 text-red-800 ring-red-600/20',
  MINOR: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  OBS: 'bg-sky-100 text-sky-800 ring-sky-600/20',
  OFI: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  CONF: 'bg-slate-100 text-slate-700 ring-slate-600/20',
};

/**
 * Cùng hệ màu với SEVERITY_STYLE nhưng nhạt hơn một bậc, dùng cho các ô thống kê.
 *
 * Thẻ chip trong bảng nhỏ nên nền -100 vừa mắt; ô thống kê là mảng màu lớn gấp
 * mấy chục lần, để nguyên -100 thì bốn ô cạnh nhau chói và át cả bảng bên dưới.
 * Giữ đúng tông màu để nhận ra ngay, chỉ hạ độ đậm.
 */
export const SEVERITY_CARD: Record<string, string> = {
  MAJOR: 'border-red-200 bg-red-50 text-red-900',
  MINOR: 'border-amber-200 bg-amber-50 text-amber-900',
  OBS: 'border-sky-200 bg-sky-50 text-sky-900',
  OFI: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  CONF: 'border-slate-200 bg-slate-50 text-slate-800',
};

export const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  AI_DRAFTED: 'bg-violet-100 text-violet-800',
  REVIEWED: 'bg-blue-100 text-blue-800',
  ISSUED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-zinc-200 text-zinc-700',
};
