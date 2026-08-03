'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SEVERITY_LABELS } from '@/lib/iso';

type Option = { id: string; label: string };

const STATUS_OPTIONS: Option[] = [
  { id: 'DRAFT', label: 'Bản nháp (chưa nộp)' },
  { id: 'SUBMITTED', label: 'Đã nộp' },
  { id: 'REVIEWED', label: 'Đã rà soát' },
  { id: 'CLOSED', label: 'Đã đóng' },
];

/**
 * Bộ lọc ghi vào tham số URL thay vì trạng thái nội bộ — nhờ vậy trưởng đoàn
 * gửi được đường link đã lọc sẵn cho người khác, và bấm quay lại vẫn giữ bộ lọc.
 */
export function FindingFilters({
  units, members,
}: {
  units: Option[];
  members: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  const hasFilter = ['unit', 'member', 'severity', 'status'].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select label="Đơn vị" value={params.get('unit') ?? ''} onChange={(v) => setParam('unit', v)} options={units} />
      <Select label="Đánh giá viên" value={params.get('member') ?? ''} onChange={(v) => setParam('member', v)} options={members} />
      <Select
        label="Mức độ"
        value={params.get('severity') ?? ''}
        onChange={(v) => setParam('severity', v)}
        options={Object.entries(SEVERITY_LABELS).map(([id, label]) => ({ id, label }))}
      />
      <Select
        label="Trạng thái"
        value={params.get('status') ?? ''}
        onChange={(v) => setParam('status', v)}
        options={STATUS_OPTIONS}
      />

      {hasFilter && (
        <button onClick={() => router.push(pathname)} className="btn-ghost">
          Bỏ lọc
        </button>
      )}
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) {
  return (
    <div>
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
