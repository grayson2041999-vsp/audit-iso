/**
 * Quy tắc của phần theo dõi khắc phục. File này KHÔNG chạm database, gọi được
 * từ cả máy chủ lẫn trình duyệt.
 */

export type CapaStatus = 'TODO' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'DONE';

export const CAPA_STATUSES: CapaStatus[] = ['TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'DONE'];

export const CAPA_LABEL: Record<CapaStatus, string> = {
  TODO: 'Chưa thực hiện',
  IN_PROGRESS: 'Đang thực hiện',
  PENDING_REVIEW: 'Chờ kiểm tra',
  DONE: 'Hoàn thành',
};

/** Chip trạng thái. */
export const CAPA_STYLE: Record<CapaStatus, string> = {
  TODO: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  PENDING_REVIEW: 'bg-violet-50 text-violet-700',
  DONE: 'bg-emerald-50 text-emerald-700',
};

/** Màu đặc cho thanh tiến độ xếp chồng. */
export const CAPA_BAR: Record<CapaStatus, string> = {
  TODO: 'bg-slate-300',
  IN_PROGRESS: 'bg-blue-500',
  PENDING_REVIEW: 'bg-violet-500',
  DONE: 'bg-emerald-500',
};

/** Phân loại nào được lập mục khắc phục — mọi loại trừ "Phù hợp". */
export const canHaveCapa = (severity?: string | null) => Boolean(severity) && severity !== 'CONF';

/** Phân loại bắt buộc khắc phục — dùng cho nút tạo nhanh và cảnh báo "chưa có mục". */
export const needsCapa = (severity?: string | null) => severity === 'MAJOR' || severity === 'MINOR';

/** Còn bao nhiêu ngày tới hạn (âm = đã quá). So theo ngày lịch "YYYY-MM-DD". */
export function daysUntil(due: string, today: string): number {
  const [y1, m1, d1] = due.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000);
}

export type DueTone = 'done' | 'overdue' | 'soon' | 'ok' | 'none';

/** Mức cảnh báo thời hạn của một mục. "Sắp đến hạn" = còn 7 ngày trở xuống. */
export function dueTone(item: { dueDate: string | null; status: CapaStatus }, today: string): DueTone {
  if (item.status === 'DONE') return 'done';
  if (!item.dueDate) return 'none';
  const d = daysUntil(item.dueDate, today);
  return d < 0 ? 'overdue' : d <= 7 ? 'soon' : 'ok';
}

/** Hôm nay theo giờ Việt Nam, "YYYY-MM-DD" — máy chủ Vercel chạy giờ UTC. */
export function todayVN(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

/** "2026-11-20" → "20/11/2026" */
export const formatDay = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

/** Phần trăm làm tròn, 0 khi không có mục nào. */
export const percent = (done: number, total: number) => (total === 0 ? 0 : Math.round((done * 100) / total));
