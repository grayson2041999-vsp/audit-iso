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

export const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  AI_DRAFTED: 'bg-violet-100 text-violet-800',
  REVIEWED: 'bg-blue-100 text-blue-800',
  ISSUED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-zinc-200 text-zinc-700',
};
