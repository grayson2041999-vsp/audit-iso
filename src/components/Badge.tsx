import { SEVERITY_LABELS, SEVERITY_SHORT, STATUS_LABELS } from '@/lib/iso';
import { SEVERITY_STYLE, STATUS_STYLE, cn } from '@/lib/utils';

/** `short` chỉ bật ở bảng tổng hợp — nơi chật chỗ và đã có màu phân biệt. */
export function SeverityBadge({ value, short = false }: { value?: string | null; short?: boolean }) {
  if (!value) {
    return (
      <span className="chip whitespace-nowrap bg-slate-100 text-slate-500 ring-slate-300">
        {short ? '—' : 'Chưa phân loại'}
      </span>
    );
  }
  const label = short ? SEVERITY_SHORT[value] : SEVERITY_LABELS[value];
  return (
    <span className={cn('chip whitespace-nowrap', SEVERITY_STYLE[value])}>{label ?? value}</span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={cn('chip ring-transparent', STATUS_STYLE[value])}>
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}
