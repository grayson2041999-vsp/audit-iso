import { SEVERITY_LABELS, STATUS_LABELS } from '@/lib/iso';
import { SEVERITY_STYLE, STATUS_STYLE, cn } from '@/lib/utils';

export function SeverityBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="chip bg-slate-100 text-slate-500 ring-slate-300">Chưa phân loại</span>;
  return <span className={cn('chip', SEVERITY_STYLE[value])}>{SEVERITY_LABELS[value] ?? value}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={cn('chip ring-transparent', STATUS_STYLE[value])}>
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}
