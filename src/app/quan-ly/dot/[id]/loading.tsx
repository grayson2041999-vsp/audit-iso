import { Bar, Block, PageHeadSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeadSkeleton />
      <div className="flex gap-4 border-b border-slate-200 pb-2">
        <Bar className="h-4 w-24" />
        <Bar className="h-4 w-32" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card space-y-3 p-5">
          <Bar className="h-4 w-48" />
          <Bar className="h-3 w-72 max-w-full" />
          <Block className="h-24" />
        </div>
      ))}
    </div>
  );
}
