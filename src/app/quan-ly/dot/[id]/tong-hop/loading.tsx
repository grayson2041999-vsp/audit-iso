import { Bar, PageHeadSkeleton, StatsSkeleton, TableSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeadSkeleton />
      <div className="flex gap-4 border-b border-slate-200 pb-2">
        <Bar className="h-4 w-24" />
        <Bar className="h-4 w-32" />
      </div>
      <StatsSkeleton />
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-9 w-36" />
        ))}
      </div>
      <TableSkeleton rows={6} cols={9} />
    </div>
  );
}
